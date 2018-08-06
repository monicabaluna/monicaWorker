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

function parseMessage (message) {
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

async function buildImage (registry, registryUsername) {
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

async function main () {
  let connection = await amqp.connect('amqp://localhost')
  var channel = await connection.createChannel()

  var queueName = 'build_rpc_queue'

  await channel.assertQueue(queueName, { durable: false })
  channel.prefetch(1)
  console.log(' [x] Awaiting RPC requests')

  let parameters

  channel.consume(queueName, async function reply (msg) {
    try {
      parameters = parseMessage(msg.content.toString())

      console.log(parameters)
      console.log(msg)

      await fetchSource(
        parameters.sourceType,
        parameters.downloadAddress,
        parameters.clientToken,
        parameters.gitToken,
        parameters.gitBranch,
        parameters.gitCommitSHA
      )

      console.log('fetch ok')
      channel.sendToQueue(msg.properties.replyTo, new Buffer('FETCH_OK'), {
        correlationId: msg.properties.correlationId
      })

      let fullTag = await buildImage(
        parameters.registry,
        parameters.registryUsername
      )

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

      console.log('push ok')
      channel.sendToQueue(msg.properties.replyTo, new Buffer('PUSH_OK'), {
        correlationId: msg.properties.correlationId
      })
    } catch (err) {
      console.error(err)

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
  })
}

main().then(null, console.warn)
