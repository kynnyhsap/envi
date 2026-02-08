export interface FileStat {
  size: number
  mtimeMs: number
}

export interface RuntimeAdapter {
  cwd(): string
  exists(filePath: string): Promise<boolean>
  readText(filePath: string): Promise<string>
  writeText(filePath: string, content: string): Promise<void>
  mkdirp(dirPath: string): Promise<void>
  stat(filePath: string): Promise<FileStat | null>
  listDirs(dirPath: string): Promise<string[]>
  findTemplateFiles(rootDir: string, templateFile: string, backupDir: string): Promise<string[]>
}
