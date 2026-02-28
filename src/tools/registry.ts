import type {Tool} from './base.js';
import {ReadFileTool} from './file-read.js';
import {ListFileTool} from './list-files.js';

// central regitry of all built in tools, agent runtime can see all tools by name here


export class ToolRegistry {
  private tools = new Map<string, Tool>();

 // constructor(){
 //   // register available tools
 //   this.register(new ReadFileTool());
 //   this.register(new ListFileTool());
 // }

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
