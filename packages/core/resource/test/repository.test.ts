import { describe, expect, it } from 'vitest'

import { DownloadTaskRepository, ResourceRepository } from '../lib/repository'
import { createTestDb, type TestDb } from './util'

describe('ResourceRepository', () => {
  it('descriptor 往返与 upsert 覆盖', async () => {
    const target: TestDb = await createTestDb()
    try {
      const repository = new ResourceRepository(target.db)
      await repository.upsert({
        kind: 'image',
        ref: 'a.png',
        size: 128,
        checksum: { algorithm: 'sha256', digest: 'aa' },
        mime: 'image/png',
      })
      await expect(repository.find('image', 'a.png')).resolves.toEqual({
        kind: 'image',
        ref: 'a.png',
        size: 128,
        checksum: { algorithm: 'sha256', digest: 'aa' },
        mime: 'image/png',
      })
      await repository.upsert({ kind: 'image', ref: 'a.png', mime: 'image/webp' })
      await expect(repository.find('image', 'a.png')).resolves.toEqual({
        kind: 'image',
        ref: 'a.png',
        mime: 'image/webp',
      })
      await repository.remove('image', 'a.png')
      await expect(repository.find('image', 'a.png')).resolves.toBeUndefined()
    } finally {
      await target.destroy()
    }
  })

  it('缺失行 find 返回 undefined', async () => {
    const target = await createTestDb()
    try {
      const repository = new ResourceRepository(target.db)
      await expect(repository.find('none', 'x')).resolves.toBeUndefined()
    } finally {
      await target.destroy()
    }
  })
})

describe('DownloadTaskRepository', () => {
  const baseTask = {
    id: 'task-1',
    kind: 'file',
    ref: 'r',
    destKey: 'dest-1',
    status: 'running',
    receivedBytes: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  it('任务 CRUD 往返', async () => {
    const target = await createTestDb()
    try {
      const tasks = new DownloadTaskRepository(target.db)
      await tasks.insert({ ...baseTask, totalBytes: 100 })
      await expect(tasks.get('task-1')).resolves.toMatchObject({
        id: 'task-1',
        status: 'running',
        receivedBytes: 10,
        totalBytes: 100,
      })
      await tasks.update('task-1', { status: 'completed', receivedBytes: 100 })
      await expect(tasks.get('task-1')).resolves.toMatchObject({
        status: 'completed',
        receivedBytes: 100,
        error: undefined,
      })
      const list = await tasks.list()
      expect(list).toHaveLength(1)
      await tasks.remove('task-1')
      await expect(tasks.get('task-1')).resolves.toBeUndefined()
    } finally {
      await target.destroy()
    }
  })
})
