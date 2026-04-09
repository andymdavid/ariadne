import { createHash, randomBytes } from 'crypto'
import { createServer } from 'http'
import { readFile } from 'fs/promises'
import { shell } from 'electron'
import { database } from '../database/database'
import type { PublishingAccount, ScheduledPublication } from '@shared/types'

const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload'
const OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'
const YOUTUBE_UPLOAD_BASE = 'https://www.googleapis.com/upload/youtube/v3'

interface YoutubeOAuthCredentials {
  clientId: string
  clientSecret?: string | null
}

function nowIso() {
  return new Date().toISOString()
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return {}
  }
  return value as Record<string, unknown>
}

function getOAuthCredentials(account: PublishingAccount): YoutubeOAuthCredentials {
  const metadata = asRecord(account.metadata)
  const clientId = typeof metadata.youtubeOAuthClientId === 'string' ? metadata.youtubeOAuthClientId.trim() : ''
  const clientSecret =
    typeof metadata.youtubeOAuthClientSecret === 'string' ? metadata.youtubeOAuthClientSecret.trim() : ''

  if (!clientId) {
    throw new Error('YouTube OAuth client ID is required')
  }

  return {
    clientId,
    clientSecret: clientSecret || null
  }
}

function base64UrlEncode(input: Buffer) {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function createPkcePair() {
  const verifier = base64UrlEncode(randomBytes(32))
  const challenge = createHash('sha256').update(verifier).digest()
  return {
    verifier,
    challenge: base64UrlEncode(challenge)
  }
}

function isTokenFresh(account: PublishingAccount) {
  if (!account.accessTokenRef || !account.tokenExpiresAt) {
    return false
  }

  return new Date(account.tokenExpiresAt).getTime() - Date.now() > 120_000
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(text || `${response.status} ${response.statusText}`)
  }
  return JSON.parse(text) as T
}

function guessMimeType(filePath: string) {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.mov')) return 'video/quicktime'
  if (lower.endsWith('.mkv')) return 'video/x-matroska'
  if (lower.endsWith('.webm')) return 'video/webm'
  return 'video/mp4'
}

async function fetchYoutubeChannel(accessToken: string) {
  const response = await fetch(
    `${YOUTUBE_API_BASE}/channels?part=snippet&mine=true`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  )

  const payload = await parseJsonResponse<{
    items?: Array<{
      id: string
      snippet?: {
        title?: string
        customUrl?: string
      }
    }>
  }>(response)

  const channel = payload.items?.[0]
  if (!channel?.id) {
    throw new Error('Unable to resolve YouTube channel for connected account')
  }

  return {
    channelId: channel.id,
    channelName: channel.snippet?.title || 'YouTube channel',
    channelHandle: channel.snippet?.customUrl ? `@${channel.snippet.customUrl.replace(/^@/, '')}` : null
  }
}

function normalizeAuthFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('invalid_grant')) {
    return {
      authStatus: 'expired' as const,
      message: 'YouTube refresh token is no longer valid. Reconnect the account.'
    }
  }
  if (message.includes('invalid_client') || message.includes('unauthorized_client')) {
    return {
      authStatus: 'error' as const,
      message: 'YouTube OAuth client credentials are invalid.'
    }
  }
  if (message.includes('access_denied') || message.includes('revoked')) {
    return {
      authStatus: 'revoked' as const,
      message: 'YouTube account access was revoked. Reconnect the account.'
    }
  }
  return {
    authStatus: 'error' as const,
    message
  }
}

export class YoutubePublishingService {
  private async exchangeToken(params: Record<string, string>) {
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(params).toString()
    })

    return parseJsonResponse<{
      access_token: string
      expires_in: number
      refresh_token?: string
      scope?: string
      token_type?: string
    }>(response)
  }

  private async createLoopbackRedirect(): Promise<{ redirectUri: string; code: Promise<string> }> {
    return new Promise((resolve, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to start local OAuth callback server'))
          return
        }

        const redirectUri = `http://127.0.0.1:${address.port}`
        resolve({
          redirectUri,
          code: new Promise<string>((resolveCode, rejectCode) => {
            server.removeAllListeners('request')
            server.on('request', (request, response) => {
              try {
                const requestUrl = new URL(request.url || '/', redirectUri)
                const code = requestUrl.searchParams.get('code')
                const error = requestUrl.searchParams.get('error')
                response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
                response.end(
                  error
                    ? '<html><body><h1>YouTube connection failed</h1><p>You can close this window.</p></body></html>'
                    : '<html><body><h1>YouTube connected</h1><p>You can close this window and return to Ariadne.</p></body></html>'
                )
                server.close()
                if (error) {
                  rejectCode(new Error(`OAuth authorization failed: ${error}`))
                  return
                }
                if (!code) {
                  rejectCode(new Error('OAuth authorization did not return a code'))
                  return
                }
                resolveCode(code)
              } catch (error) {
                rejectCode(error)
              }
            })
          })
        })
      })
    })
  }

  async connectAccount(accountId: string) {
    const account = database.getPublishingAccount(accountId)
    if (!account) {
      throw new Error('Publishing account not found')
    }

    const credentials = getOAuthCredentials(account)
    const pkce = createPkcePair()
    const { redirectUri, code } = await this.createLoopbackRedirect()

    const authUrl = new URL(OAUTH_AUTHORIZE_URL)
    authUrl.searchParams.set('client_id', credentials.clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', YOUTUBE_UPLOAD_SCOPE)
    authUrl.searchParams.set('access_type', 'offline')
    authUrl.searchParams.set('prompt', 'consent')
    authUrl.searchParams.set('code_challenge', pkce.challenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')

    await shell.openExternal(authUrl.toString())

    const authorizationCode = await code
    const tokenPayload = await this.exchangeToken({
      client_id: credentials.clientId,
      ...(credentials.clientSecret ? { client_secret: credentials.clientSecret } : {}),
      code: authorizationCode,
      code_verifier: pkce.verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    })

    const channel = await fetchYoutubeChannel(tokenPayload.access_token)
    const connectedAt = nowIso()
    const refreshedAccount: PublishingAccount = {
      ...account,
      channelId: channel.channelId,
      channelName: channel.channelName,
      channelHandle: channel.channelHandle,
      authStatus: 'connected',
      accessTokenRef: tokenPayload.access_token,
      refreshTokenRef: tokenPayload.refresh_token ?? account.refreshTokenRef ?? null,
      tokenExpiresAt: new Date(Date.now() + tokenPayload.expires_in * 1000).toISOString(),
      metadata: {
        ...asRecord(account.metadata),
        youtubeConnectedAt: connectedAt
      },
      updatedAt: connectedAt
    }

    database.upsertPublishingAccount(refreshedAccount)
    return database.getPublishingAccount(account.id) ?? refreshedAccount
  }

  disconnectAccount(accountId: string) {
    const account = database.getPublishingAccount(accountId)
    if (!account) {
      throw new Error('Publishing account not found')
    }

    const disconnectedAt = nowIso()
    const nextAccount: PublishingAccount = {
      ...account,
      authStatus: 'not_connected',
      accessTokenRef: null,
      refreshTokenRef: null,
      tokenExpiresAt: null,
      metadata: {
        ...asRecord(account.metadata),
        youtubeDisconnectedAt: disconnectedAt
      },
      updatedAt: disconnectedAt
    }

    database.upsertPublishingAccount(nextAccount)
    return database.getPublishingAccount(account.id) ?? nextAccount
  }

  async refreshAccount(accountId: string) {
    const account = database.getPublishingAccount(accountId)
    if (!account) {
      throw new Error('Publishing account not found')
    }

    try {
      const accessToken = await this.getValidAccessToken(account)
      const channel = await fetchYoutubeChannel(accessToken)
      const refreshedAt = nowIso()
      const refreshedAccount: PublishingAccount = {
        ...account,
        channelId: channel.channelId,
        channelName: channel.channelName,
        channelHandle: channel.channelHandle,
        authStatus: 'connected',
        metadata: {
          ...asRecord(account.metadata),
          youtubeLastValidatedAt: refreshedAt
        },
        updatedAt: refreshedAt
      }

      database.upsertPublishingAccount(refreshedAccount)
      return database.getPublishingAccount(account.id) ?? refreshedAccount
    } catch (error) {
      const normalized = normalizeAuthFailureMessage(error)
      const failedAt = nowIso()
      const failedAccount: PublishingAccount = {
        ...account,
        authStatus: normalized.authStatus,
        updatedAt: failedAt
      }
      database.upsertPublishingAccount(failedAccount)
      throw new Error(normalized.message)
    }
  }

  async getValidAccessToken(account: PublishingAccount) {
    if (isTokenFresh(account)) {
      return account.accessTokenRef as string
    }

    if (!account.refreshTokenRef) {
      const expiredAccount: PublishingAccount = {
        ...account,
        authStatus: 'expired',
        updatedAt: nowIso()
      }
      database.upsertPublishingAccount(expiredAccount)
      throw new Error('YouTube account needs to be reconnected')
    }

    const credentials = getOAuthCredentials(account)
    let tokenPayload
    try {
      tokenPayload = await this.exchangeToken({
        client_id: credentials.clientId,
        ...(credentials.clientSecret ? { client_secret: credentials.clientSecret } : {}),
        refresh_token: account.refreshTokenRef,
        grant_type: 'refresh_token'
      })
    } catch (error) {
      const normalized = normalizeAuthFailureMessage(error)
      const failedAccount: PublishingAccount = {
        ...account,
        authStatus: normalized.authStatus,
        updatedAt: nowIso()
      }
      database.upsertPublishingAccount(failedAccount)
      throw new Error(normalized.message)
    }

    const refreshedAt = nowIso()
    const refreshedAccount: PublishingAccount = {
      ...account,
      authStatus: 'connected',
      accessTokenRef: tokenPayload.access_token,
      refreshTokenRef: account.refreshTokenRef,
      tokenExpiresAt: new Date(Date.now() + tokenPayload.expires_in * 1000).toISOString(),
      updatedAt: refreshedAt
    }

    database.upsertPublishingAccount(refreshedAccount)
    return refreshedAccount.accessTokenRef as string
  }

  private async uploadVideo(accessToken: string, publication: ScheduledPublication) {
    if (!publication.exportArtifactId) {
      throw new Error('Publication has no export artifact')
    }

    const artifact = database.getArtifactById(publication.exportArtifactId)
    const validation = database.validateArtifact(artifact)
    if (!validation.isValid || !artifact?.filePath) {
      throw new Error(validation.message ?? 'Export artifact is invalid')
    }

    const titles = database.getClipTitles(publication.clipId) as Array<{ id: string; title?: string }>
    const descriptions = database.getClipDescriptions(publication.clipId) as Array<{ id: string; description?: string }>
    const selectedTitle = titles.find((item) => item.id === publication.selectedTitleId)?.title?.trim()
    const selectedDescription = descriptions
      .find((item) => item.id === publication.selectedDescriptionId)
      ?.description?.trim()

    if (!selectedTitle) {
      throw new Error('Selected title is missing')
    }

    const fileBytes = await readFile(artifact.filePath)
    const videoMimeType = guessMimeType(artifact.filePath)
    const scheduledDate = new Date(publication.scheduledForUtc)
    const publishAt = new Date(scheduledDate.getTime() + 60_000).toISOString()

    const metadata = {
      snippet: {
        title: selectedTitle.slice(0, 100),
        description: (selectedDescription || '').slice(0, 5000),
        categoryId: '22'
      },
      status: {
        privacyStatus: 'private',
        publishAt,
        selfDeclaredMadeForKids: false
      }
    }

    const startResponse = await fetch(
      `${YOUTUBE_UPLOAD_BASE}/videos?part=snippet,status&uploadType=resumable`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': String(fileBytes.byteLength),
          'X-Upload-Content-Type': videoMimeType
        },
        body: JSON.stringify(metadata)
      }
    )

    if (!startResponse.ok) {
      throw new Error(await startResponse.text())
    }

    const uploadLocation = startResponse.headers.get('location')
    if (!uploadLocation) {
      throw new Error('YouTube resumable upload did not return an upload URL')
    }

    const uploadResponse = await fetch(uploadLocation, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': videoMimeType
      },
      body: fileBytes
    })

    return parseJsonResponse<{
      id: string
      status?: {
        uploadStatus?: string
        privacyStatus?: string
        publishAt?: string
      }
    }>(uploadResponse)
  }

  private async uploadThumbnail(accessToken: string, publication: ScheduledPublication, videoId: string) {
    const thumbnails = database.getClipThumbnails(publication.clipId) as Array<{ id: string; file_path?: string; filePath?: string }>
    const selected = thumbnails.find((item) => item.id === publication.selectedThumbnailId)
    const thumbnailPath = selected?.file_path || selected?.filePath
    if (!thumbnailPath) {
      return
    }

    const fileBytes = await readFile(thumbnailPath)
    const response = await fetch(
      `${YOUTUBE_UPLOAD_BASE}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': guessMimeType(thumbnailPath)
        },
        body: fileBytes
      }
    )

    if (!response.ok) {
      throw new Error(await response.text())
    }
  }

  async schedulePublication(publicationId: string) {
    const publication = database.getScheduledPublication(publicationId)
    if (!publication) {
      throw new Error('Scheduled publication not found')
    }

    const account = database.getPublishingAccount(publication.publishingAccountId)
    if (!account) {
      throw new Error('Publishing account not found')
    }

    const accessToken = await this.getValidAccessToken(account)
    const video = await this.uploadVideo(accessToken, publication)
    if (publication.selectedThumbnailId) {
      await this.uploadThumbnail(accessToken, publication, video.id)
    }

    return {
      youtubeVideoId: video.id,
      youtubeVideoUrl: `https://youtube.com/watch?v=${video.id}`,
      youtubeUploadStatus: video.status?.uploadStatus || 'uploaded',
      platformConfirmedPublishAtUtc: publication.scheduledForUtc
    }
  }
}

export const youtubePublishingService = new YoutubePublishingService()
