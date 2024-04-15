
import { PluginParameter, anyDict } from '../index.d'
import { PluginConfig } from '../config.d'
import { ipcRenderer } from 'electron'
import Plugin from './plugin'

export default class extends Plugin {

  constructor(config: PluginConfig) {
    super(config)
  }

  isEnabled(): boolean {
    return this.config.enabled && this.config.binpath
  }

  getName(): string {
    return 'run_python_code'
  }

  getDescription(): string {
    return 'Execute Python code and return the result'
  }

  getRunningDescription(): string {
    return 'Executing code……'
  }

  getParameters(): PluginParameter[] {
    return [
      {
        name: 'script',
        type: 'string',
        description: 'The script to run',
        required: true
      }
    ]
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(parameters: anyDict): Promise<anyDict> {

    // make sure last line is a print
    let script = parameters.script
    const lines = script.split('\n')
    const lastLine = lines[lines.length - 1]
    if (!lastLine.startsWith('print(')) {
      lines[lines.length - 1] = `print(${lastLine})`
      script = lines.join('\n')
    }

    // now run it
    const output = ipcRenderer.sendSync('run-python-code', script)
    if (output.error) return output
    else return { result: output?.join('\n') }
  }  

}
