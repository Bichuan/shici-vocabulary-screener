import { describe, expect, it, vi } from 'vitest'
import { shareOrDownloadFile, type FileTransferAdapter } from '../src/domain/fileTransfer.ts'

function adapter(overrides: Partial<FileTransferAdapter> = {}): FileTransferAdapter {
  return {
    canShare: () => true,
    share: async () => {},
    download: () => {},
    ...overrides,
  }
}

describe('iOS 文件分享', () => {
  it('支持文件分享时直接交给系统分享面板', async () => {
    const share = vi.fn(async (file: File) => {
      expect(file.name).toBe('backup.json')
      expect(file.type).toBe('application/json')
      expect(await file.text()).toBe('{"ok":true}')
    })
    const download = vi.fn()
    const result = await shareOrDownloadFile('{"ok":true}', 'backup.json', 'application/json', '学习备份', adapter({ share, download }))

    expect(result).toBe('shared')
    expect(share).toHaveBeenCalledOnce()
    expect(download).not.toHaveBeenCalled()
  })

  it('系统不支持文件分享或分享失败时回退为下载', async () => {
    const unsupportedDownload = vi.fn()
    expect(await shareOrDownloadFile('csv', 'words.csv', 'text/csv', '错词表', adapter({
      canShare: () => false,
      download: unsupportedDownload,
    }))).toBe('downloaded')
    expect(unsupportedDownload).toHaveBeenCalledOnce()

    const failedDownload = vi.fn()
    expect(await shareOrDownloadFile('csv', 'words.csv', 'text/csv', '错词表', adapter({
      share: async () => { throw new Error('share unavailable') },
      download: failedDownload,
    }))).toBe('downloaded')
    expect(failedDownload).toHaveBeenCalledOnce()
  })

  it('用户取消系统分享时不再触发下载', async () => {
    const download = vi.fn()
    const result = await shareOrDownloadFile('csv', 'words.csv', 'text/csv', '错词表', adapter({
      share: async () => { throw new DOMException('cancelled', 'AbortError') },
      download,
    }))

    expect(result).toBe('cancelled')
    expect(download).not.toHaveBeenCalled()
  })
})
