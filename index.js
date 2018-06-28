'use strict'
const asyncFs = require('async-file')
// const log = require('bunyan').getLogger('container')
const execSync = require('child_process').execSync
const nodegit = require('nodegit')
const fs = require('fs')
const httpStatus = require('http-status-codes')
const request = require('request')
const unzip = require('unzip')

const fsUtils = require('./file-utils.js')
const dockerUtils = require('./docker-utils.js')

const clientToken = "1234"
const address = "http://localhost:3001/api/v1/archives?filePath=boop.zip"
const tmp = "tmp"
const downloadPath = require("path").join(__dirname, tmp + ".zip");
const contentPath = require("path").join(__dirname, tmp);
const credentials = require('./credentials.json')
const username = credentials.username
const password = credentials.password
const registry = "docker.io"

const git_address = "https://github.com/monicabaluna/wyliTheRepo.git"
const git_token = credentials.git_token
const git_branch = "branch1"
const git_commit_sha = "4fd86adc8d128f1e070738d901611b73e9708400"

// TODO move git functs to separate file
function checkOutCommit(repo, commit_sha) {
  console.log('Changing HEAD to ', commit_sha);
  repo.setHeadDetached(commit_sha, repo.defaultSignature(), "Checkout: HEAD " + commit_sha);
  console.log('Checking out HEAD');
  return nodegit.Checkout.head(repo, {
    checkoutStrategy: nodegit.Checkout.STRATEGY.FORCE
  });
}

async function main () {
  try {
    // =============download archive====================
    // await fsUtils.downloadArchive(address, downloadPath, clientToken, 1)
    // await fsUtils.extractAsync(downloadPath, contentPath)


    // =============git clone====================
    // source, branch, sha
    // TODO check git error codes

    let cloneOptions = {}
    cloneOptions.checkoutBranch = git_branch
    cloneOptions.fetchOpts = {
      callbacks: {
        certificateCheck: function() { return 1; },
        credentials: function() {
          return nodegit.Cred.userpassPlaintextNew(git_token, "x-oauth-basic");
        }}};
    
    let cloneRepo = await nodegit.Clone(git_address, contentPath, cloneOptions)
    let repository = await nodegit.Repository.open(contentPath)
    checkOutCommit(repository, git_commit_sha)


// =========common==========
    let imageConfiguration = JSON.parse(
      await asyncFs.readFile(`${contentPath}/wyliodrin.json`, 'utf8')
    )

    let fullTag = await dockerUtils.buildAppImage(contentPath, username,
      imageConfiguration.repository, imageConfiguration.tag)
    execSync(`docker login -u ${username} -p ${password} ${registry}`)
    let code = execSync(`docker push ${fullTag}`)

    //TODO delete contents and zip

  }
  catch(err) {
    if (typeof err.cmd === 'undefined' || err.cmd.substring(0, 7) !== "docker ")
      console.error(err)
  }
}

main()
