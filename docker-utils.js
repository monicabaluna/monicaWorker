const asyncFs = require('async-file')
// const log = require('bunyan').getLogger('container')
const { Docker } = require('node-docker-api')
const execSync = require('child_process').execSync
const fsUtils = require('./file-utils.js')
const dockerParser = require('docker-file-parser')
const fs = require('fs')
const tar = require('tar-fs')

const docker = new Docker()

function parsedDockerfileContent (data) {
  let commands = dockerParser.parse(data, { includeComments: false })
  let parsedCommands = commands.map(x => x['raw'])

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
  let data = await asyncFs.readFile(dockerfilePath, 'utf8')

  let parsedCommands = parsedDockerfileContent(data)

  await asyncFs.unlink(dockerfilePath)

  await asyncFs.writeFile(dockerfilePath, parsedCommands.join('\n'))
  console.log('The file was generated!')
}

const promisifyTarStream = stream =>
  new Promise((resolve, reject) => {
    // stream.on('data', data => console.log(data.toString()))
    stream.on('data', {})
    stream.on('end', resolve)
    stream.on('error', reject)
  })

async function buildAppImage(contentPath, username, repository, tag) {
  let fullTag = `${username}/${repository}:${tag}`
  // fullTag = `${imageConfiguration.appId}:${imageConfiguration.version}`
  
  await fixDockerfile(`${contentPath}/Dockerfile`)

  let tarStream = tar.pack(`${contentPath}`)
  let stream = await docker.image.build(tarStream, { t: fullTag })

  await fsUtils.promisifyTarStream(stream)

  return fullTag
}

module.exports = {
  fixDockerfile,
  buildAppImage
}