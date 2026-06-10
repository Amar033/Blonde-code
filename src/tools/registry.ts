import type {Tool} from './base.js';
import {ReadFileTool} from './file-read.js';
import {ListFilesTool} from './list-files.js';
import {WriteFileTool} from './file-write.js';
import {EditFileTool} from './file-edit.js';
import {BashTool} from './bash.js';
import {GrepTool} from './grep.js';
import {GlobTool} from './glob.js';
import {WebFetchTool} from './web-fetch.js';
import {WebSearchTool} from './web-search.js';
import {GitStatusTool, GitDiffTool, GitLogTool, GitAddTool, GitCommitTool, GitBranchTool, GitStashTool} from './git.js';
import {FileTreeTool} from './file-tree.js';
import {SearchCodebaseTool} from './search-codebase.js';
import {DeleteFileTool, RenameFileTool} from './file-ops.js';
import {ReplaceBlockTool} from './replace-block.js';

// central regitry of all built in tools, agent runtime can see all tools by name here


export class ToolRegistry {
  private tools = new Map<string, Tool>();

  constructor(){
    // register available tools
    this.register(new ReadFileTool());
    this.register(new ListFilesTool());
    this.register(new WriteFileTool());
    this.register(new EditFileTool());
    this.register(new BashTool());
    this.register(new GrepTool());
    this.register(new GlobTool());
    this.register(new WebFetchTool());
    this.register(new WebSearchTool());
    this.register(new GitStatusTool());
    this.register(new GitDiffTool());
    this.register(new GitLogTool());
    this.register(new GitAddTool());
    this.register(new GitCommitTool());
    this.register(new GitBranchTool());
    this.register(new GitStashTool());
    this.register(new FileTreeTool());
    this.register(new SearchCodebaseTool());
    this.register(new DeleteFileTool());
    this.register(new RenameFileTool());
    this.register(new ReplaceBlockTool());
  }

  register (tool: Tool): void {
    if (this.tools.has(tool.name)){
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  // get  tool by name 
  get(name:string): Tool | undefined {
    return this.tools.get(name);
  }
  
  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  // list all available
  list(): Tool[]{
    return Array.from(this.tools.values());
  }

  // get tool description
  getToolDescriptions(): string {
    return this.list().map(tool=>{
      const args = JSON.stringify(tool.argsSchema,null,2);
      return `Tool: ${tool.name}
      Description: ${tool.description}
      Args: ${tool.isDangerous}
      Requires Approval: ${tool.requiresApproval}`;    
    })
    .join('\n\n');
  }
}
