import type { IncomingMessage, ServerResponse } from 'node:http'
import { Writable } from 'node:stream'
import zlib from 'node:zlib'

type Res = ServerResponse<IncomingMessage>
type Unzip = zlib.Gunzip | zlib.Inflate
type Zip = zlib.Gzip | zlib.Deflate
type Callback = (body: string | undefined) => string | undefined

/**
 * Modify the response
 * @param res {Object} The http response
 * @param contentEncoding {String} The http header content-encoding: gzip/deflate
 * @param callback {Function} Custom modified logic
 */
export function modifyResponse(res: ServerResponse<IncomingMessage>, contentEncoding: string | undefined, callback: Callback) {
  let unzip: Unzip | undefined
  let zip: Zip | undefined
  // Now only deal with the gzip/deflate/undefined content-encoding.
  switch (contentEncoding) {
    case 'gzip': {
      unzip = zlib.createGunzip()
      zip = zlib.createGzip()
      break
    }
    case 'deflate': {
      unzip = zlib.createInflate()
      zip = zlib.createDeflate()
      break
    }
  }

  // The cache response method can be called after the modification.
  const _write = res.write
  const _end = res.end

  if (unzip && zip) {
    unzip.on('error', e => {
      _end.call(res, Buffer.from(String(e)), 'utf-8', undefined)
    })
    handleCompressed(res, _write, _end, unzip, zip, callback)
  } else if (contentEncoding) {
    throw new Error(`Not supported content-encoding: ${contentEncoding}`)
  } else {
    handleUncompressed(res, _write, _end, callback)
  }
}

/**
 * handle compressed
 */
function handleCompressed(res: Res, _write: Res['write'], _end: Res['end'], unzip: Unzip, zip: Zip, callback: Callback) {
  // The rewrite response method is replaced by unzip stream.
  res.write = (data: any) => {
    return unzip.write(data)
  }

  res.end = () => {
    unzip.end()
    return res
  }

  function concatStream(callback: (data: Buffer) => void) {
    const stream = new Writable()
    const chunks: Buffer[] = []

    stream._write = (chunk, _, done) => {
      chunks.push(chunk)
      done()
    }

    stream._final = done => {
      callback(Buffer.concat(chunks))
      done()
    }

    return stream
  }

  unzip.pipe(
    concatStream(data => {
      let body = data.toString()

      if (typeof callback === 'function') {
        // Custom modified logic
        const res = callback(body)
        if (res !== undefined) {
          body = res
        }
      }

      const bBody = Buffer.from(body)

      // Call the response method and recover the content-encoding.
      zip.on('data', chunk => {
        _write.call(res, chunk, 'utf-8', undefined)
      })
      zip.on('end', () => {
        _end.call(res, undefined, 'utf-8', undefined)
      })

      zip.write(bBody)
      zip.end()
    })
  )
}

/**
 * handle Uncompressed
 */
function handleUncompressed(res: Res, _write: Res['write'], _end: Res['end'], callback: Callback) {
  const chunks: Uint8Array[] = []
  // Rewrite response method and get the content.
  res.write = (data: any) => {
    chunks.push(data)
    return true
  }

  res.end = () => {
    let body = Buffer.concat(chunks).toString()
    // Custom modified logic
    if (typeof callback === 'function') {
      const resp = callback(body)
      if (resp !== undefined) {
        body = resp
      }
    }

    const bBody = Buffer.from(body)

    // Call the response method
    _write.call(res, bBody, 'utf-8', undefined)
    _end.call(res, undefined, 'utf-8', undefined)
    return res
  }
}
