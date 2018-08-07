'use strict'

const amqp = require('amqplib')
const asyncFs = require('async-file')
// const log = require('bunyan').getLogger('worker')
const execSync = require('child_process').execSync
const fs = require('fs')
const unzip = require('unzip')

const dockerUtils = require('./docker-utils.js')
const fsUtils = require('./file-utils.js')
const gitUtils = require('./git-utils.js')

const tmp = 'tmp'
const downloadPath = require('path').join(__dirname, tmp + '.zip')
const contentPath = require('path').join(__dirname, tmp)
const queueName = 'build_rpc_queue'

async function main () {
  // open connection and channel to rabbit queue
  let connection = await amqp.connect('amqp://localhost')
  let channel = await connection.createChannel()

  // make sure queue exists (start it if it didn't)
  await channel.assertQueue(queueName, { durable: false })
  channel.prefetch(1)
  console.log(' [x] Awaiting RPC requests')

  // set task handler
  channel.consume(queueName, processTask(channel))
}

const processTask = channel => async msg => {
  let parameters

  try {
    parameters = parseMessage(msg.content.toString())

    await fetchSource(
      parameters.sourceType,
      parameters.downloadAddress,
      parameters.clientToken,
      parameters.gitToken,
      parameters.gitBranch,
      parameters.gitCommitSHA
    )

    // successful download notification
    console.log('fetch ok')
    channel.sendToQueue(msg.properties.replyTo, new Buffer('FETCH_OK'), {
      correlationId: msg.properties.correlationId
    })

    let fullTag = await buildImage(parameters.registryUsername)

    // successful build notification
    console.log('build ok')
    channel.sendToQueue(
      msg.properties.replyTo,
      new Buffer(`BUILD_OK ${fullTag}`),
      {
        correlationId: msg.properties.correlationId
      }
    )

    await pushImage(
      fullTag,
      parameters.registry,
      parameters.registryUsername,
      parameters.registryPassword
    )

    // successful registry push notification
    console.log('push ok')
    channel.sendToQueue(msg.properties.replyTo, new Buffer('PUSH_OK'), {
      correlationId: msg.properties.correlationId
    })
  } catch (err) {
    console.error(err)

    // error notification
    channel.sendToQueue(
      msg.properties.replyTo,
      new Buffer(`ERROR ${err.toString()}`),
      {
        correlationId: msg.properties.correlationId
      }
    )
  }
  await fsUtils.clean(parameters.sourceType, contentPath, downloadPath)
  channel.ack(msg)
}

function parseMessage (message) {
  // parse query parameters
  // TODO: sanitize inputs

  let received = JSON.parse(message)
  let result = {}

  if (typeof received === 'undefined') throw Error('Invalid message format')

  result.sourceType = received.sourceType
  result.downloadAddress = received.downloadAddress
  result.clientToken = received.clientToken
  result.registry = received.registry
  result.registryPassword = received.registryPassword
  result.registryUsername = received.registryUsername

  switch (received.sourceType) {
    case 'zip':
      return result

    case 'git':
      if (typeof received.gitBranch === 'undefined') {
        result.gitBranch = 'master'
      }

      if (typeof received.gitToken === 'undefined') {
        result.gitToken = ''
      } else {
        result.gitToken = received.gitToken
      }

      result.gitCommitSHA = received.gitCommitSHA
  }

  return result
}

async function fetchSource (
  sourceType,
  downloadAddress,
  clientToken,
  gitToken,
  gitBranch,
  gitCommitSHA
) {
  // download app code from github or zip archive

  try {
    await fsUtils.clean(sourceType, contentPath, downloadPath)

    switch (sourceType) {
      case 'zip':
        await fsUtils.downloadArchive(
          downloadAddress,
          downloadPath,
          clientToken,
          1
        )
        await fsUtils.extractAsync(downloadPath, contentPath)
        break

      case 'git':
        let repository = await gitUtils.cloneRepoBranch(
          downloadAddress,
          gitBranch,
          gitToken,
          contentPath
        )

        if (typeof gitCommitSHA !== 'undefined') {
          await gitUtils.checkOutCommit(repository, gitCommitSHA)
        }
        break

      default:
        throw Error('Invalid source type')
    }
  } catch (err) {
    throw Error(err)
  }
}

async function buildImage (registryUsername) {
  // build imafe with custom tag
  try {
    let imageConfiguration = JSON.parse(
      await asyncFs.readFile(`${contentPath}/wyliodrin.json`, 'utf8')
    )

    let fullTag = await dockerUtils.buildAppImage(
      contentPath,
      registryUsername,
      imageConfiguration.repository,
      imageConfiguration.tag
    )

    return fullTag
  } catch (err) {
    throw Error(err)
  }
}

async function pushImage (
  fullTag,
  registry,
  registryUsername,
  registryPassword
) {
  // push image to registry

  try {
    execSync(
      `docker login -u ${registryUsername} -p ${registryPassword} ${registry}`
    )
    execSync(`docker push ${fullTag}`)
    execSync('docker logout')
  } catch (err) {
    throw Error('Docker login or push failed')
  }
}

main().then(null, console.error)
