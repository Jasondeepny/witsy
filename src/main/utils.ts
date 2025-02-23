import { strDict } from '../types/index';
import { execSync } from 'node:child_process'
import { v4 as uuidv4 } from 'uuid'

const textCache: strDict = {}

export const wait = (millis = 200) => new Promise<void>((resolve) => setTimeout(resolve, millis));

export const fixPath = (): void => {

  try {

    // on windows everything is fine
    if (process.platform === 'win32') {
      return
    }

    // macOS and Linux need to fix the PATH
    const command = `${process.env.SHELL} -l -c 'echo -n "_SHELL_ENV_DELIMITER_"; printenv PATH; echo -n "_SHELL_ENV_DELIMITER_";'`
    const output = execSync(command).toString();
    const path = output.split('_SHELL_ENV_DELIMITER_')[1].trim();
    console.log('Fixing PATH:', path)
    process.env.PATH = path;

  } catch (error) {
    console.error('Failed to fix PATH:', error)
  }

}

export const getCachedText = (id: string): string => {
  const prompt = textCache[id]
  delete textCache[id]
  return prompt
}

export const putCachedText = (text: string): string => {
  const id = uuidv4()
  textCache[id] = text
  return id
}
