export interface Config {
  appId: string
  token: string
  cluster: string
  wsUrl?: string
}

export interface RequestParams {
  app: {
    appid: string
    cluster: string
    token: string
  }
  user: {
    uid: string
  }
  request: {
    reqid: string
    nbest: number
    workflow: string
    show_language: boolean
    show_utterances: boolean
    result_type: string
    sequence: number
  }
  audio: {
    format: string
    rate: number
    language: string
    bits: number
    channel: number
    codec: string
  }
}

export interface Response {
  code: number
  message?: string
  result?: any
} 