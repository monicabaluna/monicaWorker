'use strict'
const asyncFs = require('async-file')
// const log = require('bunyan').getLogger('container')
const execSync = require('child_process').execSync
const fs = require('fs')
const unzip = require('unzip')

const dockerUtils = require('./docker-utils.js')
const fsUtils = require('./file-utils.js')
const gitUtils = require('./git-utils.js')

const clientToken = "1234"
const address = "http://localhost:3001/api/v1/archives?filePath=boop.zip"
const tmp = "tmp"
const downloadPath = require("path").join(__dirname, tmp + ".zip");
const contentPath = require("path").join(__dirname, tmp);
const credentials = require('./credentials.json')
const username = credentials.username
const password = credentials.password
const registry = "docker.io"

const sourceType = "git"
const gitAddress = "https://github.com/monicabaluna/wyliTheRepo.git"
const gitToken = credentials.gitToken
const gitBranch = "branch1"
const gitCommitSHA = "4fd86adc8d128f1e070738d901611b73e9708400"


async function main () {
  try {

    switch (sourceType) {

      case "zip":
        await fsUtils.downloadArchive(address, downloadPath, clientToken, 1)
        await fsUtils.extractAsync(downloadPath, contentPath)
        break;

      case "git":
        let repository = await gitUtils.cloneRepoBranch(gitAddress, gitBranch, gitToken, contentPath)
        gitUtils.checkOutCommit(repository, gitCommitSHA)
        break;

      default:
        throw Error("Invalid source type")
    }

    let imageConfiguration = JSON.parse(
      await asyncFs.readFile(`${contentPath}/wyliodrin.json`, 'utf8')
    )

    let fullTag = await dockerUtils.buildAppImage(contentPath, username,
      imageConfiguration.repository, imageConfiguration.tag)
    execSync(`docker login -u ${username} -p ${password} ${registry}`)
    execSync(`docker push ${fullTag}`)

    await fsUtils.clean(sourceType, contentPath, downloadPath)
  }
  catch(err) {
    if (typeof err.cmd === 'undefined' || err.cmd.substring(0, 7) !== "docker ") {
      throw Error(err)
    }
    else {
      throw Error("Docker login or push failed")
    }
  }
}

main().catch(err => console.error(err));
