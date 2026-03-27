package cache

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/dgraph-io/ristretto"
)

type Service struct {
	store *ristretto.Cache
}

var (
	globalOnce sync.Once
	globalSvc  *Service
)

func Global() *Service {
	globalOnce.Do(func() {
		store, err := ristretto.NewCache(&ristretto.Config{
			NumCounters: 1 << 14,
			MaxCost:     1 << 26,
			BufferItems: 64,
		})
		if err != nil {
			panic(fmt.Sprintf("cache init failed: %v", err))
		}
		globalSvc = &Service{store: store}
	})
	return globalSvc
}

func (s *Service) GetBytes(key string) ([]byte, bool) {
	if s == nil || s.store == nil {
		return nil, false
	}
	value, ok := s.store.Get(key)
	if !ok {
		return nil, false
	}
	data, ok := value.([]byte)
	if !ok {
		return nil, false
	}
	return append([]byte(nil), data...), true
}

func (s *Service) SetBytes(key string, value []byte, ttl time.Duration) {
	if s == nil || s.store == nil {
		return
	}
	s.store.SetWithTTL(key, append([]byte(nil), value...), int64(len(value)), ttl)
}

func RememberJSON[T any](svc *Service, key string, ttl time.Duration, loader func() (T, error)) (T, error) {
	var zero T
	if svc != nil {
		if raw, ok := svc.GetBytes(key); ok {
			var value T
			if err := json.Unmarshal(raw, &value); err == nil {
				return value, nil
			}
		}
	}

	value, err := loader()
	if err != nil {
		return zero, err
	}

	if svc != nil {
		if raw, marshalErr := json.Marshal(value); marshalErr == nil {
			svc.SetBytes(key, raw, ttl)
		}
	}

	return value, nil
}
