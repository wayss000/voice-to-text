import { generateHeader, parseResponse } from '../protocol'
import { gzip } from 'pako'

describe('Protocol', () => {
  test('generateHeader should create correct header', () => {
    const header = generateHeader()
    expect(header.length).toBe(4)
    expect(header[0] >> 4).toBe(0b0001) // PROTOCOL_VERSION
  })

  test('parseResponse should handle SERVER_FULL_RESPONSE with JSON payload', () => {
    const testData = { text: 'hello' }
    const jsonData = JSON.stringify(testData)
    const compressedData = gzip(Buffer.from(jsonData))
    
    const payload = Buffer.alloc(4 + compressedData.length)
    payload.writeInt32BE(compressedData.length, 0)
    Buffer.from(compressedData).copy(payload, 4)
    
    const header = Buffer.from([
      0b00010001, // version and header size
      0b10010000, // SERVER_FULL_RESPONSE
      0b00010001, // JSON and GZIP
      0x00        // reserved
    ])
    
    const response = Buffer.concat([header, payload])
    const result = parseResponse(response)
    
    expect(result.payload_msg).toEqual(testData)
    expect(result.payload_size).toBe(compressedData.length)
  })
}) 