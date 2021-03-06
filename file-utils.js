'use strict'
const asyncFs = require('async-file')
// const log = require('bunyan').getLogger('worker')
const del = require('del')
const fs = require('fs')
const request = require('request')
const sha = require('sha1')
const unzip = require('unzip')

const promisifyTarStream = stream =>
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
    stream.on('end', () => {
      resolve(checksum)
    })
    stream.on('response', function (response) {
      if (response.statusCode / 100 != 2) return reject()
      checksum = response.headers['checksum']
      response.pipe(file)
    })
  })

const extractAsync = (zipPath, outputPath) =>
  new Promise((resolve, reject) => {
    const extractor = unzip.Extract({ path: outputPath })

    extractor.on('close', resolve)
    extractor.on('error', reject)

    fs.createReadStream(zipPath).pipe(extractor)
  })

async function downloadArchive (address, downloadPath, token, retriesLeft) {
  // private archive downloader with retries count
  let file
  let checksum
  let fileContents

  for (let i = 0; i <= retriesLeft; i++) {
    try {
      file = fs.createWriteStream(downloadPath)
      checksum = await promisifyDownloadStream(
        request.get(address, {
          auth: {
            bearer: token
          }
        }),
        file
      )

      fileContents = asyncFs.readFile(downloadPath)

      if (checksum !== sha(fileContents)) {
        continue
      }
      return
    } catch (err) {
      console.error('Error downloading archive. Retrying...')
      continue
    }
  }

  return Promise.reject(new Error('Error downloading archive.'))
}

async function clean (sourceType, contentPath, downloadPath) {
  // delete app source
  try {
    if (sourceType === 'zip') await del([downloadPath])

    await del([contentPath + '/*', contentPath])
  } catch (err) {
    console.log('some delete error: ', err)
  }

  console.log('Successfully removed resources.')
}

module.exports = {
  downloadArchive,
  extractAsync,
  promisifyTarStream,
  clean
}
