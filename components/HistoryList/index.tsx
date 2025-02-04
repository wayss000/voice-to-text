'use client'
import React, { useState, useEffect } from 'react'
import styles from './styles.module.css'

interface HistoryItem {
  id: string
  text: string
  timestamp: string
  success: boolean
  error?: string
}

interface HistoryListProps {
  items: HistoryItem[]
  onCopy?: (text: string) => void
}

export function HistoryList({ items, onCopy }: HistoryListProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // 如果还没有挂载，返回一个占位结构
  if (!mounted) {
    return (
      <div className={styles['history-section']}>
        <div className={styles['history-header']}>
          <h3>历史记录</h3>
        </div>
        <div className={styles['history-list']}>
          <div className={styles['history-empty']}>
            加载中...
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles['history-section']}>
      <div className={styles['history-header']}>
        <h3>历史记录</h3>
        <span className={styles['history-count']}>
          共 {items.length} 条记录
        </span>
      </div>

      <div className={styles['history-list']}>
        {items.map((item) => (
          <div key={item.id} className={styles['history-card']}>
            <div className={styles['history-card-header']}>
              <span className={styles['history-time']}>
                {new Date(item.timestamp).toLocaleString()}
              </span>
              <span className={`${styles['history-status']} ${!item.success ? styles.error : ''}`}>
                {item.success ? '转换成功' : '转换失败'}
              </span>
            </div>

            <div className={styles['history-text']}>
              {item.success ? item.text : item.error}
            </div>

            {item.success && (
              <div className={styles['history-footer']}>
                <button
                  onClick={() => onCopy?.(item.text)}
                  className={styles['history-copy-btn']}
                >
                  复制文本
                </button>
              </div>
            )}
          </div>
        ))}

        {items.length === 0 && (
          <div className={styles['history-empty']}>
            暂无历史记录
          </div>
        )}
      </div>
    </div>
  )
} 