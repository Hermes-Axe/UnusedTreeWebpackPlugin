const fs = require('fs');
const path = require('path');
const glob = require('glob');
const chalk = require('chalk');

const EMIT_NAME = 'UnusedTreeWebpackPlugin'

const currentPath = path.resolve(__dirname);
const checkPath = path.resolve(currentPath);

const skipCheckPath = [
  'node_modules'
]
const skipCheckFiles = [
  'type.ts'
]

function setDefault(val, def) {
  return val === undefined ? def : val;
}

class UnusedTreeWebpackPlugin {
  constructor(opt = {}) {
    this.usedFiles = []
    this.allFiles = []
    this.allFilesListMap = []
    opt = {
      checkPath: setDefault(opt.checkPath, checkPath),
      needReport: setDefault(opt.needReport, false),
      reportPath: setDefault(opt.reportPath, currentPath),
      onlyShowUnused: setDefault(opt.onlyShowUnused, true),
      reportFileName: setDefault(opt.reportFileName, 'report.txt'),
      skipFiles: setDefault(opt.skipFiles, skipCheckFiles),
      skipPath: Array.isArray(opt.skipPath) ? opt.skipPath.push(...skipCheckPath) : skipCheckPath,
    }
    this.opt = opt
  }

  setOption(compiler) {
    if (!this.opt.reportPath) {
      this.opt.reportPath = compiler.options.output.path || currentPath
    }
  }

  apply(compiler) {
    this.setOption(compiler)

    const checkUnusedFiles = (compilation, callback) => {
      this.usedFiles = Array.from(compilation.fileDependencies)
      this.getAllFiles().then(() => {
        this.getAllFileTree()
        this.getStatistics()
        const report = this.getAllFileTreeLog()
        if (this.opt.needReport) {
          this.writeReport(report)
        }
        return callback()
      })
    }

    // webpack>=4
    if (compiler.hooks && compiler.hooks.emit) {
      compiler.hooks.emit.tapAsync(EMIT_NAME, checkUnusedFiles.bind(this))
    } else {
      // webpack3
      compiler.plugin('emit', checkUnusedFiles.bind(this))
    }
  }

  isSkip(dir) {
    return !dir.startsWith(this.opt.checkPath) || this.opt.skipPath.some(skipPath => dir.startsWith(skipPath))
  }

  getAllFiles() {
    return new Promise((resolve, reject) => {
      glob(
        '**/*.*',
        {
          cwd: this.opt.checkPath,
          nodir: true
        },
        (err, files) => {
          if (err) {
            console.log(`[${EMIT_NAME}]Get All Files Error: `, err);
            reject(err)
            return
          }
          this.allFiles = (files || []).map(filePath => path.join(this.opt.checkPath, filePath))
          resolve(this.allFiles)
        }
      )
    })
  }

  /**
   * 将平铺的文件路径转换成树结构
   * [
   *    { fileName: 'a', isDir: true, children: [] },
   *    { fileName: 'b.js', isDir: false, children: null },
   * ]
   */
  getAllFileTree() { 
    let allFiles = this.allFiles
    if (this.opt.onlyShowUnused) {
      allFiles = allFiles.filter(filePath => !this.usedFiles.some(el => el === filePath))
    }
    let fileList = _getFilePathList.call(this, allFiles)
    let result = []
    for (let index = 0; index < fileList.length; index++) {
      const currentFilePathList = fileList[index]
      let curPath;
      let curResultObj = result;
      while (curPath = currentFilePathList.shift()) {
        const isDir = currentFilePathList.length > 0
        const findParent = curResultObj.find(el => el.fileName === curPath)
        if (findParent) {
          curResultObj = findParent.children
        } else {
          const obj = {
            fileName: curPath,
            isDir,
            children: isDir ? [] : null,
            usedCount: 0,
            subFileCount: 0,
          }
          curResultObj.push(obj)
          curResultObj = obj.children
        }
      }
    }

    // 获取每个文件夹（包括子文件夹）中文件的数量
    function _getFileTreeCount(list = []) {
      let currentDirFileCount = 0
      for (let index = 0; index < list.length; index++) {
        const currentFile = list[index]
        const isDir = currentFile.isDir
        if (isDir && currentFile.children && currentFile.children.length) {
          currentFile.subFileCount = _getFileTreeCount(currentFile.children)
          currentDirFileCount += currentFile.subFileCount
        } else {
          currentDirFileCount++
        }
      }
      return currentDirFileCount
    }
    _getFileTreeCount(result)
    this.allFilesListMap = result
  }

  getStatistics() {
    let usedFiles = _getFilePathList.call(this, this.usedFiles)
    for (let index = 0; index < usedFiles.length; index++) {
      const currentFilePathList = usedFiles[index]
      let curPath;
      let curResultObj = this.allFilesListMap;
      while (curPath = currentFilePathList.shift()) {
        const findParent = curResultObj.find(el => el.fileName === curPath)
        if (findParent) {
          if (!currentFilePathList.length) {
            findParent.usedCount++
          } else {
            curResultObj = findParent.children || []
          }
        }
      }
    }

    function _getUsedFileCount(list = []) {
      let currentDirUsedCount = 0
      for (let index = 0; index < list.length; index++) {
        const currentFile = list[index]
        const isDir = currentFile.isDir
        if (isDir && currentFile.children && currentFile.children.length) {
          currentFile.usedCount = _getUsedFileCount(currentFile.children)
        }
        currentDirUsedCount += currentFile.usedCount
      }
      return currentDirUsedCount
    }
    _getUsedFileCount(this.allFilesListMap)
  }

  getAllFileTreeLog() { 
    let resultMapStr = ''
    const TREE_STR_CONSTANT = {
      space: ' ',
      splitor: '│',
      newline: '\n',
      linker: '─',
      lastLinker: '└',
      partitialLinker: '├',
    }

    traceFileTree(this.allFilesListMap, (file, { index, parent }, prefix = '') => {
      const isDir = file.isDir
      const isLast = index === parent.length - 1
      const fillChar = isLast ? TREE_STR_CONSTANT.lastLinker : TREE_STR_CONSTANT.partitialLinker
      let fileName = chalk.red(file.fileName)
      if (isDir) {
        if (this.opt.onlyShowUnused) {
          fileName = chalk.yellow(file.fileName)
        } else {
          if (file.usedCount >= file.subFileCount) {
            fileName = chalk.green(file.fileName)
          }
          if (file.usedCount >= 1 && file.usedCount !== file.subFileCount) {
            fileName = chalk.yellow(file.fileName)
          }
        }
      } else {
        if (this.opt.onlyShowUnused) {
          fileName = file.fileName
        } else {
          if (file.usedCount >= 1) {
            fileName = chalk.green(file.fileName)
          }
        }
      }
      resultMapStr += prefix + fillChar + TREE_STR_CONSTANT.linker + fileName + TREE_STR_CONSTANT.newline
      const newPrefix = prefix + (isLast ? TREE_STR_CONSTANT.space : TREE_STR_CONSTANT.splitor) + TREE_STR_CONSTANT.space
      return newPrefix
    })
    const INFO = `\nTotal File List:\n(${chalk.red('redFileName')} is not used; ${chalk.yellow('yellowFileName')} is partly used; ${chalk.green('greenFileName')} is fully used)`
    console.log(INFO + '\n' + resultMapStr)
    return resultMapStr
  }

  writeReport(reportStr) {
    const reportFileRealPath = path.join(this.opt.reportPath, this.opt.reportFileName)
    if (fs.existsSync(reportFileRealPath)) {
      fs.unlinkSync(reportFileRealPath)
    }
    fs.writeFileSync(reportFileRealPath, this.opt.checkPath + '\n' + reportStr)
  }
}

function _getFilePathList(fileList = []) {
  return fileList
    .slice()
    .map(filePath => filePath.replace(this.opt.checkPath, ''))
    .map(item => item.split('\\'))
    .map(item => ((item[0] === '' && item.shift()), item))
}

function traceFileTree(fileList = [], callback = (item, info, retargs) => {}) { 
  function _traceInner(list, args) {
    for (let index = 0; index < list.length; index++) {
      const currentFile = list[index]
      const isDir = currentFile.isDir
      let returnArgs = callback(currentFile, { index, parent: list }, args)
      if (isDir && currentFile.children && currentFile.children.length) {
        _traceInner(currentFile.children, returnArgs)
      }
    }
  }
  _traceInner(fileList)
}

module.exports = UnusedTreeWebpackPlugin
