// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { FileDownloadParams, FileSaveParams, Command, ComputerAction, Expert, ExternalApp, FileContents, anyDict, strDict } from './types';
import { type Configuration } from './types/config';
import { type DocRepoQueryResponseItem } from './types/rag';
import { type RunCommandParams } from './types/automation';

import { contextBridge, ipcRenderer } from 'electron'
import { type Size } from './main/computer';

contextBridge.exposeInMainWorld(
  'api', {
    licensed: true,
    platform: process.platform,
    isMasBuild: process.mas === true,
    userDataPath: ipcRenderer.sendSync('get-app-path'),
    on: (signal: string, callback: (value: any) => void): void => { ipcRenderer.on(signal, (_event, value) => callback(value)) },
    off: (signal: string, callback: (value: any) => void): void => { ipcRenderer.off(signal, (_event, value) => callback(value)) },
    setAppearanceTheme: (theme: string): void => { return ipcRenderer.sendSync('set-appearance-theme', theme) },
    showDialog: (opts: any): Promise<Electron.MessageBoxReturnValue> => { return ipcRenderer.invoke('dialog-show', opts) },
    listFonts: (): string[] => { return ipcRenderer.sendSync('fonts-list') },
    update: {
      isAvailable: (): boolean => { return ipcRenderer.sendSync('update-is-available') },
      apply: (): void => { return ipcRenderer.send('update-apply') },
    },
    store: {
      get(key: string, fallback: any): any { return ipcRenderer.sendSync('store-get-value', { key, fallback }) },
      set(key: string, value: any): void { return ipcRenderer.send('store-set-value', { key, value }) },
    },
    runAtLogin: {
      get: (): boolean => { return ipcRenderer.sendSync('run-at-login-get').openAtLogin },
      set: (state: boolean): void => { return ipcRenderer.send('run-at-login-set', state) }
    },
    fullscreen: (state: boolean): void => { return ipcRenderer.send('fullscreen', state) },
    base64: {
      encode: (data: string): string => { return Buffer.from(data).toString('base64') },
      decode: (data: string): string => { return Buffer.from(data, 'base64').toString() },
    },
    file: {
      read: (filepath: string): FileContents => { return ipcRenderer.sendSync('read-file', filepath) },
      readIcon: (filepath: string): FileContents => { return ipcRenderer.sendSync('read-icon', filepath) },
      save: (opts: FileSaveParams): string => { return ipcRenderer.sendSync('save-file', JSON.stringify(opts)) },
      pick: (opts: any): string|strDict|string[] => { return ipcRenderer.sendSync('pick-file', JSON.stringify(opts)) },
      pickDir: (): string => { return ipcRenderer.sendSync('pick-directory') },
      download: (opts: FileDownloadParams): string => { return ipcRenderer.sendSync('download', JSON.stringify(opts)) },
      delete: (filepath: string): void => { return ipcRenderer.send('delete-file', filepath) },
      find: (name: string): string => { return ipcRenderer.sendSync('find-program', name) },
      extractText: (contents: string, format: string): string => { return ipcRenderer.sendSync('get-text-content', contents, format) },
      getAppInfo: (filepath: string): ExternalApp => { return ipcRenderer.sendSync('get-app-info', filepath) },
    },
    clipboard: {
      writeText: (text: string): void => { return ipcRenderer.send('clipboard-write-text', text) },
      writeImage: (path: string): void => { return ipcRenderer.send('clipboard-write-image', path) },
    },
    shortcuts: {
      register: (): void => { return ipcRenderer.send('shortcuts-register') },
      unregister: (): void => { return ipcRenderer.send('shortcuts-unregister') },
    },
    config: {
      load: (): Configuration => { return JSON.parse(ipcRenderer.sendSync('config-load')) },
      save: (data: Configuration) => { return ipcRenderer.send('config-save', JSON.stringify(data)) },
    },
    history: {
      load: (): History => { return JSON.parse(ipcRenderer.sendSync('history-load')) },
      save: (data: History) => { return ipcRenderer.send('history-save', JSON.stringify(data)) },
    },
    automation: {
      getText: (id: string): string => { return ipcRenderer.sendSync('automation-get-text', id) },
      replace: (text: string): void => { return ipcRenderer.send('automation-replace', text) },
      insert: (text: string): void => { return ipcRenderer.send('automation-insert', text) },
    },
    chat: {
      open: (chatid: string): void => { return ipcRenderer.send('chat-open', chatid) },
    },
    commands: {
      load: (): Command[] => { return JSON.parse(ipcRenderer.sendSync('commands-load')) },
      save: (data: Command[]) => { return ipcRenderer.send('commands-save', JSON.stringify(data)) },
      export: (): void => { return ipcRenderer.sendSync('commands-export') },
      import: (): void => { return ipcRenderer.sendSync('commands-import') },
      isPromptEditable: (id: string): boolean => { return ipcRenderer.sendSync('command-is-prompt-editable', id) },
      run: (params: RunCommandParams): void => { return ipcRenderer.send('command-run', JSON.stringify(params)) },
      closePicker: (): void => { return ipcRenderer.send('command-picker-close') },
      closeResult: (): void => { return ipcRenderer.send('command-result-close') },
      resizeResult: (deltaX : number, deltaY: number): void => { return ipcRenderer.send('command-result-resize', { deltaX, deltaY }) },
    },
    anywhere: {
      prompt: () => { return ipcRenderer.send('anywhere-prompt') },
      close: (): void => { return ipcRenderer.send('anywhere-close') },
      resize: (deltaX : number, deltaY: number): void => { return ipcRenderer.send('anywhere-resize', { deltaX, deltaY }) },
    },
    experts: {
      load: (): Expert[] => { return JSON.parse(ipcRenderer.sendSync('experts-load')) },
      save: (data: Expert[]): void => { return ipcRenderer.send('experts-save', JSON.stringify(data)) },
      export: (): void => { return ipcRenderer.sendSync('experts-export') },
      import: (): void => { return ipcRenderer.sendSync('experts-import') },
    },
    docrepo: {
      list(): strDict[] { return JSON.parse(ipcRenderer.sendSync('docrepo-list')) },
      connect(baseId: string): void { return ipcRenderer.send('docrepo-connect', baseId) },
      disconnect(): void { return ipcRenderer.send('docrepo-disconnect') },
      create(title: string, embeddingEngine: string, embeddingModel: string): string { return ipcRenderer.sendSync('docrepo-create', { title, embeddingEngine, embeddingModel }) },
      rename(baseId: string, title: string): void { return ipcRenderer.sendSync('docrepo-rename', { baseId, title }) },
      delete(baseId: string): void { return ipcRenderer.sendSync('docrepo-delete', baseId) },
      addDocument(baseId: string, type: string, url: string): void { return ipcRenderer.send('docrepo-add-document', { baseId, type, url }) },
      removeDocument(baseId: string, docId: string): void { return ipcRenderer.send('docrepo-remove-document', { baseId, docId }) },
      query(baseId: string, text: string): Promise<DocRepoQueryResponseItem[]> { return ipcRenderer.invoke('docrepo-query', { baseId, text }) },
      isEmbeddingAvailable(engine: string, model: string): boolean { return ipcRenderer.sendSync('docrepo-is-embedding-available', { engine, model }) },
    },
    readaloud: {
      closePalette: (): void => { return ipcRenderer.send('readaloud-close-palette') },
    },
    transcribe: {
      insert(text: string): void { return ipcRenderer.send('transcribe-insert', text) },
      cancel: (): void => { return ipcRenderer.send('transcribe-cancel') },
    },
    markdown: {
      render: (markdown: string): string => { return ipcRenderer.sendSync('markdown-render', markdown) },
    },
    interpreter: {
      python: (code: string): string => { return ipcRenderer.sendSync('code-python-run', code) },
    },
    nestor: {
      isAvailable: (): boolean => { return ipcRenderer.sendSync('nestor-is-available') },
      getStatus: (): Promise<any> => { return ipcRenderer.invoke('nestor-get-status') },
      getTools: (): Promise<any[]> => { return ipcRenderer.invoke('nestor-get-tools') },
      callTool: (name: string, parameters: anyDict): Promise<any> => { return ipcRenderer.invoke('nestor-call-tool', { name, parameters }) },
    },
    scratchpad: {
      open: (textId?: string): void => { return ipcRenderer.send('scratchpad-open', textId) },
    },
    dropbox: {
      getAuthenticationUrl: (): string => { return ipcRenderer.sendSync('dropbox-get-authentication-url') },
      authenticateWithCode: (code: string): boolean => { return ipcRenderer.sendSync('dropbox-authenticate-with-code', code) },
    },
    computer: {
      isAvailable: (): boolean => { return ipcRenderer.sendSync('computer-is-available') },
      getScaledScreenSize: (): Size => { return ipcRenderer.sendSync('computer-get-scaled-screen-size') },
      getScreenNumber: (): number => { return ipcRenderer.sendSync('computer-get-screen-number') },
      takeScreenshot: (): string => { return ipcRenderer.sendSync('computer-get-screenshot') },
      executeAction: (action: ComputerAction): anyDict => { return ipcRenderer.sendSync('computer-execute-action', action) },
    }
  },
);
