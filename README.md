
![claudesplunkconnection](https://github.com/user-attachments/assets/74d4f146-4dd7-49f8-a98c-f40d9ed5f9b1)
![splunkclaudeindexesexplore](https://github.com/user-attachments/assets/726856e8-005c-4f42-b514-f2f64b4aec55)
# splunk-mcp-server
Proof of Concept Splunk MCP server plus MCP file Server by Rod Soto 

# Environment
- Windows 11 Home 10.0.26100 Build 26100
- Claude Desktop (Windows 0.10.14)
- Splunk 9.3
- Node.js v8.17.0
- NPM 10.9.2
  
# Install Instructions 
- Install Node.js, NPM and Claude Desktop
- Create a directory to store MCP files
- Install dependencies
  - cd folder you created
  - npm init -y
  - npm install
  - npm install @modelcontextprotocol/server-filesystem
  - npm install @modelcontextprotocol/sdk
  - npm install splunk-sdk
- Download the files (packages.json {npm dependencies}, claude_desktop_config.json {claude config}, splunk-server.js {mcp server code})
- Place "claude_desktop_config.json" at "C:\Users\*user*\AppData\Roaming\Claude"
- Modify directories at desktop json file and splunk auth information
- Remember to close and re open claude desktop for your changes to take effect (Use task manager in windows)

    # Operation

  - Ask Claude if there are MCP Servers running, you should get an answer showing file and Splunk MCP Server running
  - Ask Claude for relevant indexes in your splunk instances or input SPL and ask cloude to execute it.
  - Windows paths need double backslashes (\\) or forward slashes (/).
  - MCP servers are started automatically by Claude Desktop when it reads your config file - they don't start separately.
  - Ask a simple question as in how many files are inside the folder, Claude can read their content as well.
  - Have fun :) 

  # MCP Logs

  - Location of MCP Logs is "C:\Users\*user*\AppData\Roaming\Claude\logs"
 
