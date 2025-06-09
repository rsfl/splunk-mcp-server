#!/usr/bin/env node

// This is a simple MCP server that allows you to search Splunk logs and data. POC by Rod Soto

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { 
  CallToolRequestSchema, 
  ListToolsRequestSchema 
} = require('@modelcontextprotocol/sdk/types.js');
const splunkjs = require('splunk-sdk');
const https = require('https');
const http = require('http');
const querystring = require('querystring');

// Create MCP server
const server = new Server(
  {
    name: 'splunk-mcp-server',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Splunk service configuration, add your own credentials here
const splunkConfig = {
  username: process.env.SPLUNK_USERNAME || "admin",
  password: process.env.SPLUNK_PASSWORD || "Password1",
  scheme: process.env.SPLUNK_SCHEME || "http",
  host: process.env.SPLUNK_HOST || "localhost",
  port: process.env.SPLUNK_PORT || "8089"
};

// Create Splunk service
const service = new splunkjs.Service(splunkConfig);

// Login to Splunk
async function loginToSplunk() {
  return new Promise((resolve, reject) => {
    service.login((err, success) => {
      if (err) {
        reject(err);
      } else {
        resolve(success);
      }
    });
  });
}

// Alternative search function using REST API directly
async function searchSplunkREST(query, options = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      // First login to get session key
      await loginToSplunk();
      
      const sessionKey = service.sessionKey;
      if (!sessionKey) {
        reject(new Error('No session key available'));
        return;
      }

      const searchParams = querystring.stringify({
        search: `search ${query}`,
        earliest_time: options.earliest_time || '-24h',
        latest_time: options.latest_time || 'now',
        count: options.count || 100,
        output_mode: 'json'
      });

      const postData = searchParams;
      const isHttps = splunkConfig.scheme === 'https';
      const httpModule = isHttps ? https : http;

      const requestOptions = {
        hostname: splunkConfig.host,
        port: splunkConfig.port,
        path: '/services/search/jobs',
        method: 'POST',
        headers: {
          'Authorization': `Splunk ${sessionKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        }
      };

      if (isHttps) {
        requestOptions.rejectUnauthorized = false; // For self-signed certs
      }

      console.error('Making REST API request to create search job...');

      const req = httpModule.request(requestOptions, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          console.error(`Response status: ${res.statusCode}`);
          console.error(`Response data: ${data.substring(0, 500)}`); // First 500 chars for debugging
          
          try {
            // Handle XML response by converting to JSON
            if (data.includes('<?xml') || data.includes('<response>')) {
              console.error('Received XML response, attempting to parse...');
              
              // Try to extract SID from XML
              const sidMatch = data.match(/<sid>([^<]+)<\/sid>/);
              if (sidMatch && sidMatch[1]) {
                const sid = sidMatch[1];
                console.error(`Extracted SID from XML: ${sid}`);
                pollForResults(sid, sessionKey, resolve, reject);
              } else {
                reject(new Error(`Failed to extract SID from XML response: ${data.substring(0, 200)}`));
              }
            } else {
              // Try JSON parsing
              const response = JSON.parse(data);
              if (response.sid) {
                console.error(`Job created with SID: ${response.sid}`);
                pollForResults(response.sid, sessionKey, resolve, reject);
              } else {
                reject(new Error(`No SID in JSON response: ${data}`));
              }
            }
          } catch (parseError) {
            reject(new Error(`Failed to parse response: ${parseError.message}. Raw response: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Request failed: ${error.message}`));
      });

      req.write(postData);
      req.end();

    } catch (error) {
      reject(error);
    }
  });
}

// Poll for search results
function pollForResults(sid, sessionKey, resolve, reject, attempts = 0) {
  const maxAttempts = 30; // 30 seconds max wait
  
  if (attempts >= maxAttempts) {
    reject(new Error('Search job timeout'));
    return;
  }

  const isHttps = splunkConfig.scheme === 'https';
  const httpModule = isHttps ? https : http;

  const requestOptions = {
    hostname: splunkConfig.host,
    port: splunkConfig.port,
    path: `/services/search/jobs/${sid}?output_mode=json`,
    method: 'GET',
    headers: {
      'Authorization': `Splunk ${sessionKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  };

  if (isHttps) {
    requestOptions.rejectUnauthorized = false;
  }

  const req = httpModule.request(requestOptions, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      try {
        const response = JSON.parse(data);
        const entry = response.entry && response.entry[0];
        
        if (entry && entry.content && entry.content.isDone) {
          console.error('Job completed, fetching results...');
          fetchResults(sid, sessionKey, resolve, reject);
        } else {
          console.error(`Job not done yet, attempt ${attempts + 1}/${maxAttempts}`);
          setTimeout(() => {
            pollForResults(sid, sessionKey, resolve, reject, attempts + 1);
          }, 1000);
        }
      } catch (parseError) {
        reject(new Error(`Failed to parse job status: ${parseError.message}`));
      }
    });
  });

  req.on('error', (error) => {
    reject(new Error(`Status check failed: ${error.message}`));
  });

  req.end();
}

// Fetch the actual results
function fetchResults(sid, sessionKey, resolve, reject) {
  const isHttps = splunkConfig.scheme === 'https';
  const httpModule = isHttps ? https : http;

  const requestOptions = {
    hostname: splunkConfig.host,
    port: splunkConfig.port,
    path: `/services/search/jobs/${sid}/results?output_mode=json&count=100`,
    method: 'GET',
    headers: {
      'Authorization': `Splunk ${sessionKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  };

  if (isHttps) {
    requestOptions.rejectUnauthorized = false;
  }

  const req = httpModule.request(requestOptions, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      try {
        const response = JSON.parse(data);
        console.error(`Retrieved ${response.results ? response.results.length : 0} results`);
        
        resolve({
          results: response.results || [],
          job_sid: sid,
          result_count: response.results ? response.results.length : 0
        });
      } catch (parseError) {
        reject(new Error(`Failed to parse results: ${parseError.message}`));
      }
    });
  });

  req.on('error', (error) => {
    reject(new Error(`Results fetch failed: ${error.message}`));
  });

  req.end();
}

// Search Splunk function
async function searchSplunk(query, options = {}) {
  console.error('Attempting search with REST API method...');
  return searchSplunkREST(query, options);
}

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'splunk_search',
        description: 'Search Splunk logs and data',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Splunk search query (SPL)'
            },
            earliest_time: {
              type: 'string',
              description: 'Earliest time for search (default: -24h)'
            },
            latest_time: {
              type: 'string',
              description: 'Latest time for search (default: now)'
            },
            count: {
              type: 'number',
              description: 'Maximum number of results (default: 100)'
            }
          },
          required: ['query']
        }
      },
      {
        name: 'splunk_test',
        description: 'Test Splunk connection and authentication',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'splunk_indexes',
        description: 'List available Splunk indexes',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Ensure we're logged in
    await loginToSplunk();

    switch (name) {
      case 'splunk_test':
        try {
          await loginToSplunk();
          const sessionKey = service.sessionKey;
          
          return {
            content: [
              {
                type: 'text',
                text: `Splunk Connection Test Results:
✅ Login successful
✅ Session key obtained: ${sessionKey ? sessionKey.substring(0, 20) + '...' : 'None'}
✅ Host: ${splunkConfig.host}:${splunkConfig.port}
✅ Username: ${splunkConfig.username}
✅ Scheme: ${splunkConfig.scheme}

Connection is working properly!`
              }
            ]
          };
        } catch (testError) {
          return {
            content: [
              {
                type: 'text',
                text: `Splunk Connection Test Failed:
❌ Error: ${testError.message}
❌ Host: ${splunkConfig.host}:${splunkConfig.port}
❌ Username: ${splunkConfig.username}
❌ Scheme: ${splunkConfig.scheme}

Please check your Splunk configuration and credentials.`
              }
            ],
            isError: true
          };
        }

      case 'splunk_search':
        try {
          const searchResults = await searchSplunk(args.query, {
            earliest_time: args.earliest_time,
            latest_time: args.latest_time,
            count: args.count
          });
          
          // Format results for better readability
          let formattedOutput = `Splunk Search Results for: ${args.query}\n`;
          formattedOutput += `Job SID: ${searchResults.job_sid}\n`;
          formattedOutput += `Result Count: ${searchResults.result_count}\n\n`;
          
          if (searchResults.results && searchResults.results.length > 0) {
            // Show first few results in a readable format
            const displayResults = searchResults.results.slice(0, 10);
            displayResults.forEach((result, index) => {
              formattedOutput += `Result ${index + 1}:\n`;
              Object.keys(result).forEach(key => {
                if (result[key] && key !== '_bkt' && key !== '_cd') {
                  formattedOutput += `  ${key}: ${result[key]}\n`;
                }
              });
              formattedOutput += `\n`;
            });
            
            if (searchResults.results.length > 10) {
              formattedOutput += `... and ${searchResults.results.length - 10} more results\n`;
            }
          } else {
            formattedOutput += `No results found for query: ${args.query}\n`;
          }
          
          return {
            content: [
              {
                type: 'text',
                text: formattedOutput
              }
            ]
          };
        } catch (searchError) {
          console.error('Search error:', searchError);
          return {
            content: [
              {
                type: 'text',
                text: `Search Error: ${searchError.message}\n\nTroubleshooting tips:\n- Check if the index exists\n- Verify search syntax\n- Ensure time range contains data\n- Check Splunk permissions`
              }
            ],
            isError: true
          };
        }

      case 'splunk_indexes':
        return new Promise((resolve, reject) => {
          service.indexes().fetch((err, indexes) => {
            if (err) {
              reject(err);
            } else {
              const indexList = indexes.list().map(index => index.name);
              resolve({
                content: [
                  {
                    type: 'text',
                    text: `Available Splunk Indexes:\n${indexList.join('\n')}`
                  }
                ]
              });
            }
          });
        });

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`
        }
      ],
      isError: true
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Splunk MCP server running');
}

main().catch(console.error);