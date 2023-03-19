import fs from 'fs'
import { fdir } from 'fdir'
import { nanoid } from 'nanoid'
import { fileTypeFromBuffer } from 'file-type'
import sharp from 'sharp'

export default function remoteAssets() {
  return {
    name: 'remoteAssets',
    enforce: 'post',
    async closeBundle() {
      const matchMap = {}
      const allImageUrls = []
      const genericMatch = /\b(https?:\/\/[\w_#&?.\/-]*?\.(?:png|jpe?g|svg|ico))(?=[`'")\]])/ig
      const imageSourceMatch = /<img[^>]*src=['|"](https?:\/\/[^'|"]+)(?:['|"])/ig
      const bgSourceMatch = /(?:.*(?<='|")background-image:url\((https?.*)\);(?='|"))/ig
      const matchable = [
        genericMatch,
        imageSourceMatch,
        bgSourceMatch,
      ]
      const crawler = new fdir().glob("**/*.html").withFullPaths();
      const files = crawler.crawl("dist/client").sync();
      await Promise.all(
        files.map(async (filePath) => {
          let contents = fs.readFileSync(filePath, { encoding: 'utf-8' })
          let updatedContents = ''
          matchMap[filePath] = []
          await Promise.all(
            matchable.map(async match => {
              let matched = Array.from(contents.matchAll(match), (m) => m[1]);
              await Promise.all(
                matched.map(async imageUrl => {
                  if (imageUrl) {
                    // hack for amazon sw3 urls.
                    // TODO add handling of notion hosted files, as right now only external is supported forcing unsplash usage for all images.
                    if (imageUrl.includes('cdninstagram') || imageUrl.includes('amazonaws')) {
                      imageUrl = imageUrl.replaceAll('&amp;', '&');
                    }
                    allImageUrls.push(imageUrl)
                    const response = await fetch(imageUrl);
                    const arrayBuffer = await response.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    const fileType = await fileTypeFromBuffer(buffer);
                    if (fileType?.ext) {
                      const outPath = 'dist/client/remote'
                      const id = nanoid(6)
                      // Long term replace tthis with what we extract from the URL
                      const filename = `${id}.remote.webp`
                      matchMap[filePath].push({
                        filename,
                        url: imageUrl
                      })
                      const outputFilePath = `${outPath}/${filename}`
                      if (!fs.existsSync(outPath)) fs.mkdirSync(outPath)
                      let imageBuffer = await sharp(buffer)
                      // Resize based on existing size and aspect ratio
                      const sixteenByNine = 1.7777
                      const resizedImage = await imageBuffer.metadata().then(async metadata => {
                        const resize = []
                        const shrinkPerc = 0.125
                        if ((metadata.width / metadata.height) < sixteenByNine) {
                          const minWidthProfile = 720
                          const minHeightProfile = 800
                          // is profile, 
                          if ((metadata.width * shrinkPerc) < minWidthProfile) resize[0] = minWidthProfile
                          else resize[0] = metadata.width * shrinkPerc
                          if ((metadata.height * shrinkPerc) < minHeightProfile) resize[1] = minHeightProfile
                          else resize[1] = metadata.height * shrinkPerc
                        } else {
                          const minWidth = 1280
                          const minHeight = 720
                          // is profile, 
                          if ((metadata.width * shrinkPerc) < minWidth) resize[0] = minWidth
                          else resize[0] = metadata.width * shrinkPerc
                          if ((metadata.height * shrinkPerc) < minHeight) resize[1] = minHeight
                          else resize[1] = metadata.height * shrinkPerc
                        }
                        return await imageBuffer.resize(Math.round(resize[0]), Math.round(resize[1]), {
                          fit: 'cover',
                        })
                      })

                      const webPBuffer = await resizedImage.webp({ nearLossless: true, effort: 6 }).toBuffer();

                      fs.createWriteStream(outputFilePath).write(webPBuffer);
                      if (!updatedContents) {
                        // what a dumb hack
                        // if we don't do this, the replaceall cant find the proper url below
                        if (contents.includes('cdninstagram') || contents.includes('amazonaws')) {
                          contents = contents.replaceAll('&amp;', '&');
                        }
                        updatedContents = contents.replace(imageUrl, `/remote/${filename}`)
                      } else {
                        updatedContents = updatedContents.replace(imageUrl, `/remote/${filename}`)
                      }
                      console.log('rewriting', filePath)
                    } else {
                      console.log('File type could not be reliably determined! The binary data may be malformed! No file saved!')
                    }
                    fs.writeFileSync('debug/image.json', JSON.stringify(matchMap))
                    fs.writeFileSync('debug/imageUrls.json', JSON.stringify(allImageUrls))
                  }
                })
              )
            }))
          if (updatedContents) fs.writeFileSync(filePath, updatedContents)
        })
      )
    }
  }
}
