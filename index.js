'use strict'
const asyncFs = require('async-file')
// const log = require('bunyan').getLogger('container')
const execSync = require('child_process').execSync
const dockerParser = require('docker-file-parser')
const fs = require('fs')
const httpStatus = require('http-status-codes')
const { Docker } = require('node-docker-api')
const tar = require('tar-fs')
const unzip = require('unzip')
const request = require('request')
const sha = require('sha1')
// const request = require('request-promise')

const docker = new Docker()
// const router = express.Router()

const token = "1234"
const address = "http://localhost:3001/api/v1/archives?filePath=upload_a27f4604ba858e810c063895d5d0dfcf"

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

const promisifyStream = stream =>
  new Promise((resolve, reject) => {
    stream.on('data', data => console.log(data.toString()))
    stream.on('end', resolve)
    stream.on('error', reject)
  })

const promisifyDownloadStream = (stream, file) =>
  new Promise((resolve, reject) => {
    let checksum

    stream.on('data', data => {})
    stream.on('error', reject)
    stream.on('end', () => {resolve(checksum)})
    stream.on('response', function(response) {
      if (response.statusCode / 100 != 2)
        return reject
      checksum = response.headers['checksum']
      response.pipe(file)
    })
  })

const pathExists = path =>
  new Promise((resolve, reject) => {
    fs.access(path, fs.constants.F_OK, err => {
      if (err !== null && err.code !== 'ENOENT') return reject(err)
      resolve(err === null)
    })
  })

const extractAsync = (zipPath, outputPath) =>
  new Promise((resolve, reject) => {
    const extractor = unzip.Extract({ path: outputPath })

    extractor.on('close', resolve)
    extractor.on('error', reject)

    fs.createReadStream(zipPath).pipe(extractor)
  })

async function downloadArchive (address, token, retriesLeft) {
  let file
  let checksum
  let fileContents

  let handleDownloadErr = async (err) => {
    if (retriesLeft <= 0)
      throw err
    console.log("Error downloading archive. Retrying...")
    await downloadArchive(address, token, retriesLeft - 1)
  }

  try {
    file = fs.createWriteStream('downloaded.zip');
    checksum = await promisifyDownloadStream(request.get(address, {
      'auth': {
        'bearer': token
      }
    }), file)

    fileContents = asyncFs.readFile('downloaded.zip')

    if (checksum !== sha(fileContents)) {
      throw new Error("Error downloading archive")
    }

  } catch(err) {
    await handleDownloadErr(err)
  }
}

async function main () {
  try {
    await downloadArchive(address, token, 1)
  }
  catch(err) {
    throw err
  }
}

main()

/**
 * @api {post} / Send an archive with stuff to dockerize
 * @apiName Post
 * @apiGroup User
 *
 * @apiParam {String} username Username
 *
 * @apiSuccess {Number} err 0
 * @apiError {String} err Error
 * @apiError {String} statusError error
 */
// router.post('/build-archive', async function (
//   { body: { download_url, registry, username, password } },
//   res
// ) {
//   const uploadDir = 'files/'
//   let checksum = md5(download_url)
//   let contentPath = `${uploadDir}${checksum}`
//   let zipPath = `${contentPath}.zip`

//   await wget(download_url, { output: zipPath })
//   console.log(`Upload zip to ${zipPath}`)

//   await extractAsync(zipPath, contentPath)

//   try {
//     let imageConfiguration = JSON.parse(
//       await asyncFs.readFile(`${contentPath}/wyliodrin.json`, 'utf8')
//     )

//     let fullTag = `${username}/${imageConfiguration.repository}:${imageConfiguration.tag}`
//     await fixDockerfile(`${contentPath}/Dockerfile`)

//     let tarStream = tar.pack(`${contentPath}`)
//     let stream = await docker.image.build(tarStream, { t: fullTag })

//     await promisifyStream(stream)

//     execSync(`docker login -u ${username} -p ${password} ${registry}`)

//     let code = execSync(`docker push ${fullTag}`)
//     console.log(code.toString())
//   } catch (err) {
//     throw err
//   }

//   res.sendStatus(httpStatus.OK)
// })

// router.post('/build-repository', async function (
//   { body: { source_url, branch, registry, username, password } },
//   res
// ) {
//   const uploadDir = 'files/'

//   try {
//     let sha = execSync(`git ls-remote -h ${source_url} -t ${branch} | cut -f 1`)
//     let contentPath = `${uploadDir}${sha.toString().trim()}`

//     let repoIsCached = await pathExists(contentPath)
//     if (!repoIsCached) {
//       execSync(
//         `git clone --recursive -b ${branch} ${source_url} ${contentPath}`
//       )
//     }

//     let imageConfiguration = JSON.parse(
//       await asyncFs.readFile(`${contentPath}/wyliodrin.json`, 'utf8')
//     )
//     let fullTag = `${username}/${imageConfiguration.repository}:${imageConfiguration.tag}`

//     await fixDockerfile(`${contentPath}/Dockerfile`)

//     let tarStream = tar.pack(`${contentPath}`)
//     let stream = await docker.image.build(tarStream, { t: fullTag })

//     await promisifyStream(stream)

//     execSync(`docker login -u ${username} -p ${password} ${registry}`)

//     let code = execSync(`docker push ${fullTag}`)
//     console.log(code.toString())
//   } catch (err) {
//     throw err
//   }

//   res.sendStatus(httpStatus.OK)
// })

// router.post('/build', async function (
//   { body: { source_url, source_type, username, password, branch, contentSha } },
//   res
// ) {
//   const uploadDir = 'files/'
//   let contentPath

//   try {
//     if (source_type === 'repository') {
//       contentPath = `${uploadDir}${branch}-${contentSha}`

//       let repoIsCached = await pathExists(contentPath)
//       if (!repoIsCached) {
//         execSync(
//           `git clone --recursive -b ${branch} ${source_url} ${contentPath}; git checkout ${contentSha}`
//         )
//       }
//     }

//     if (source_type === 'archive') {
//       let checksum = md5(download_url)
//       contentPath = `${uploadDir}${checksum}`
//       let zipPath = `${contentPath}.zip`

//       await wget(download_url, { output: zipPath })
//       console.log(`Upload zip to ${zipPath}`)

//       await extractAsync(zipPath, contentPath)
//     }

//     // ============= common part ===============
//     let imageConfiguration = JSON.parse(
//       await asyncFs.readFile(`${contentPath}/wyliodrin.json`, 'utf8')
//     )
//     let fullTag = `${imageConfiguration.appId}:${imageConfiguration.version}`

//     await fixDockerfile(`${contentPath}/Dockerfile`)

//     let tarStream = tar.pack(`${contentPath}`)
//     let stream = await docker.image.build(tarStream, { t: fullTag })

//     await promisifyStream(stream)

//     execSync(
//       `docker login -u ${username} -p ${password} ${imageConfiguration.repository}`
//     )

//     let code = execSync(`docker push ${fullTag}`)
//     console.log(code.toString())
//   } catch (err) {
//     throw err
//   }

//   res.sendStatus(httpStatus.OK)
// })
