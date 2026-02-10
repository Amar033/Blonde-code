export class ListFilesTool extends BaseTool{
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
