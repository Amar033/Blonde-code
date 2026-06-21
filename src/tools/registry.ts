import type {Tool} from './base.js';
import type {ToolConfig} from './base.js';
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

  constructor(workspacePath: string){
    const cfg: ToolConfig = { workspacePath };
    // register available tools
    this.register(new ReadFileTool(cfg));
    this.register(new ListFilesTool(cfg));
    this.register(new WriteFileTool(cfg));
    this.register(new EditFileTool(cfg));
    this.register(new BashTool(cfg));
    this.register(new GrepTool(cfg));
    this.register(new GlobTool(cfg));
    this.register(new WebFetchTool(cfg));
    this.register(new WebSearchTool(cfg));
    this.register(new GitStatusTool(cfg));
    this.register(new GitDiffTool(cfg));
    this.register(new GitLogTool(cfg));
    this.register(new GitAddTool(cfg));
    this.register(new GitCommitTool(cfg));
    this.register(new GitBranchTool(cfg));
    this.register(new GitStashTool(cfg));
    this.register(new FileTreeTool(cfg));
    this.register(new SearchCodebaseTool(cfg));
    this.register(new DeleteFileTool(cfg));
    this.register(new RenameFileTool(cfg));
    this.register(new ReplaceBlockTool(cfg));
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
