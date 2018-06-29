'use strict'

const amqp = require( 'amqp' )
const amqp_stream = require( 'amqp-stream' );
const asyncFs = require('async-file')
// const log = require('bunyan').getLogger('container')
const execSync = require('child_process').execSync
const fs = require('fs')
const unzip = require('unzip')

const dockerUtils = require('./docker-utils.js')
const fsUtils = require('./file-utils.js')
const gitUtils = require('./git-utils.js')

const tmp = "tmp"
const downloadPath = require("path").join(__dirname, tmp + ".zip");
const contentPath = require("path").join(__dirname, tmp);

function parseMessage(message) {
  let received = JSON.parse(message)
  let result = {}

  if (typeof received === "undefined")
    throw Error("Invalid message format")

  result.sourceType = received.sourceType
  result.downloadAddress = received.downloadAddress
  result.clientToken = received.clientToken
  result.registry = received.registry
  result.registryPassword = received.registryPassword
  result.registryUsername = received.registryUsername

  switch (received.sourceType) {

    case "zip":
      break;

    case "git":
      if (typeof received.gitBranch === "undefined") {
        result.gitBranch = "master"
      }

      if (typeof received.gitToken === "undefined") {
        result.gitToken = ""
      } else {
        result.gitToken = received.gitToken 
      }

      result.gitCommitSHA = received.gitCommitSHA
  }

  return result
}

async function fetchSource(sourceType, downloadAddress, clientToken,
  gitToken, gitBranch, gitCommitSHA) {
  try {
    switch (sourceType) {

      case "zip":
        await fsUtils.downloadArchive(downloadAddress, downloadPath, clientToken, 1)
        await fsUtils.extractAsync(downloadPath, contentPath)
        break;

      case "git":
        let repository = await gitUtils.cloneRepoBranch(downloadAddress, gitBranch, gitToken, contentPath)

        if (typeof gitCommitSHA !== undefined)
          await gitUtils.checkOutCommit(repository, gitCommitSHA)
        break;

      default:
        throw Error("Invalid source type")
    }
  } catch(err) {
    throw Error(err)
  }
}

async function build (sourceType, downloadAddress, clientToken, gitToken, 
  registry, registryUsername, registryPassword, gitBranch, gitCommitSHA) {

  try {

    let imageConfiguration = JSON.parse(
      await asyncFs.readFile(`${contentPath}/wyliodrin.json`, 'utf8')
    )

    let fullTag = await dockerUtils.buildAppImage(contentPath, registryUsername,
      imageConfiguration.repository, imageConfiguration.tag)
    execSync(`docker login -u ${registryUsername} -p ${registryPassword} ${registry}`)
    execSync(`docker push ${fullTag}`)
    execSync("docker logout")

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

let connection = amqp.createConnection();
amqp_stream( {connection:connection, exchange:'rpc', routingKey:'upper'}, function ( err, rpc_stream ) {
  rpc_stream.on( 'correlatedRequest', function (correlatedStream) {
    correlatedStream.on( 'data', function (buf) {

      let parameters = parseMessage(buf.toString())

      fetchSource(parameters.sourceType, parameters.downloadAddress,
        parameters.clientToken, parameters.gitToken, parameters.gitBranch,
        parameters.gitCommitSHA)

      .then(() => {
        correlatedStream.write("FETCH_OK");
        build(parameters.sourceType, parameters.downloadAddress, parameters.clientToken,
          parameters.gitToken, parameters.registry, parameters.registryUsername,
          parameters.registryPassword, parameters.gitBranch, parameters.gitCommitSHA)
        })
      .then(() => {correlatedStream.write("we made it!"); correlatedStream.end()})
      .catch(err => {
        console.error(err);
        correlatedStream.write("stupid ho [-(");
        correlatedStream.end();
      })      
    });
  });
});

