package ratelimit

import (
	"context"
	"sync"
	"time"
)

type memoryEntry struct {
	window int64
	count  int
}

// MemoryLimiter implements a fixed-window in-memory rate limiter.
type MemoryLimiter struct {
	mu       sync.Mutex
	counters map[string]*memoryEntry
}

// NewMemoryLimiter constructs a MemoryLimiter.
func NewMemoryLimiter() *MemoryLimiter {
	return &MemoryLimiter{
		counters: make(map[string]*memoryEntry),
	}
}

// Allow checks whether the request should be allowed in the current second.
func (l *MemoryLimiter) Allow(_ context.Context, key string, limit int, now time.Time) (Result, error) {
	return l.allowWindow(key, limit, now, time.Second)
}

func (l *MemoryLimiter) allowWindow(key string, limit int, now time.Time, window time.Duration) (Result, error) {
	if limit <= 0 || key == "" {
		return Result{Allowed: true}, nil
	}
	windowSeconds := normalizeWindowSeconds(window)
	bucket := now.Unix() / windowSeconds
	reset := time.Unix((bucket+1)*windowSeconds, 0).UTC()

	l.mu.Lock()
	entry := l.counters[key]
	if entry == nil {
		entry = &memoryEntry{window: bucket}
		l.counters[key] = entry
	}
	if entry.window != bucket {
		entry.window = bucket
		entry.count = 0
	}
	if entry.count >= limit {
		l.mu.Unlock()
		return Result{Allowed: false, Remaining: 0, Reset: reset}, nil
	}
	entry.count++
	remaining := limit - entry.count
	l.mu.Unlock()
	return Result{Allowed: true, Remaining: remaining, Reset: reset}, nil
}
