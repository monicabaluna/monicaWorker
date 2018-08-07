const asyncFs = require('async-file')
// const log = require('bunyan').getLogger('worker')
const { Docker } = require('node-docker-api')
const fsUtils = require('./file-utils.js')
const dockerParser = require('docker-file-parser')
const tar = require('tar-fs')

const docker = new Docker()

function parsedDockerfileContent (data) {
  // add calls to cross-build scripts if needed
  let commands = dockerParser.parse(data, { includeComments: false })
  let parsedCommands = commands.map(x => x['raw'])

  // check if calls are needed
  if (
    parsedCommands.length == 0 ||
    parsedCommands[0].substring(0, 11) !== 'FROM resin/' ||
    parsedCommands[1] === 'RUN [ "cross-build-start" ]'
  ) {
    return parsedCommands
  }

  parsedCommands.splice(1, 0, 'RUN [ "cross-build-start" ]')
  parsedCommands.push('RUN [ "cross-build-end" ]\n')

  return parsedCommands
}

async function fixDockerfile (dockerfilePath) {
  // replace dockerfile with equivalent that can pe cross-built
  let data = await asyncFs.readFile(dockerfilePath, 'utf8')

  let parsedCommands = parsedDockerfileContent(data)

  await asyncFs.unlink(dockerfilePath)

  await asyncFs.writeFile(dockerfilePath, parsedCommands.join('\n'))
  console.log('The file was generated!')
}

async function buildAppImage (contentPath, username, repository, tag) {
  // build docker image for any platform

  // TODO choose the right format for image tag naming
  let fullTag = `${username}/${repository}:${tag}`
  // fullTag = `${imageConfiguration.appId}:${imageConfiguration.version}`

  // adjust dockerfile to be cross-built
  await fixDockerfile(`${contentPath}/Dockerfile`)

  // pack the app into a tar-formated stream
  let tarStream = tar.pack(`${contentPath}`)
  // build docker image from the tar stream
  let stream = await docker.image.build(tarStream, { t: fullTag })

  // await stream (and build) completion
  await fsUtils.promisifyTarStream(stream)

  return fullTag
}

module.exports = {
  fixDockerfile,
  buildAppImage
}
