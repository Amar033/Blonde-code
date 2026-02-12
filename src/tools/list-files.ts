import {promises as fs} from 'fs';
import {BaseTool,ToolResult,FakeRunResult} from './base.js';


// tool for listing files
export class ListFileTool extends BaseTool{
  name= 'list_files';
  description = 'List files in a directory';

  argsSchema = {
    type: 'object' as const,
    properties: {
      path: {type: 'string', default: '.'},
      pattern: {type: 'string', description: 'Optional glob pattern'},
    },
  };

  isDangerous = false;
  requiresApproval = false;

  async fakeRun(args: unknown): Promise<FakeRunResult>{
    const {path='.'} = args as {path?: string};

    try{
      await fs.access(path);
      const stats = await fs.stat(path);
      if (!stats.isDirectory()){
        return {
          wouldSucceed: false,
          description: `Path is not a directory: ${path}`,
          warnings: ['Not a Directory'],
        };
      }
      return{
          wouldSucceed: true,
          description: `Would list files in: ${path}`,
      };
    }catch{
      return{
        wouldSucceed: false,
        description: `Directory does not exist: ${path}`,
        warnings: ['Directory not found'],
      };
    }
  }

  async execute (args: unknown): Promise<ToolResult>{
    const {path = '.', pattern } = args as {
      path?: string;
      pattern?: string;
    };

    try {
      const entries = await fs.readdir(path,{withFileTypes: true});

      // filter out noise
      const filtered = entries.filter(e=>
        !e.name.startsWith('.') &&
        e.name !== 'node_modules' &&
        e.name !== 'dist'
      );

      const files = filtered.map(e=>({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        path: `${path}/${e.name}`,
      }));

      return {
        success: true,
        output: {path,files,count: files.length},
      };
    }catch(error){
      return {
        success: false,
        output: null,
        error: `Failed to list ${error}`,
      };
    }
  }
}
