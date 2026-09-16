export type FileTransferResult = 'shared' | 'downloaded' | 'cancelled'

export interface FileTransferAdapter {
  canShare(file: File): boolean
  share(file: File, title: string): Promise<void>
  download(file: File): void
}

function browserAdapter(): FileTransferAdapter {
  return {
    canShare(file) {
      return typeof navigator.share === 'function' &&
        (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] }))
    },
    share(file, title) {
      return navigator.share({ files: [file], title })
    },
    download(file) {
      const url = URL.createObjectURL(file)
      const link = document.createElement('a')
      link.href = url
      link.download = file.name
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    },
  }
}

export async function shareOrDownloadFile(
  content: BlobPart,
  fileName: string,
  type: string,
  title: string,
  adapter: FileTransferAdapter = browserAdapter(),
): Promise<FileTransferResult> {
  const file = new File([content], fileName, { type })
  if (adapter.canShare(file)) {
    try {
      await adapter.share(file, title)
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    }
  }
  adapter.download(file)
  return 'downloaded'
}
