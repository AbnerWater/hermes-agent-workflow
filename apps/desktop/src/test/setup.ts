class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>()

  get length() {
    return this.data.size
  }

  clear() {
    this.data.clear()
  }

  getItem(key: string) {
    return this.data.get(String(key)) ?? null
  }

  key(index: number) {
    return Array.from(this.data.keys())[index] ?? null
  }

  removeItem(key: string) {
    this.data.delete(String(key))
  }

  setItem(key: string, value: string) {
    this.data.set(String(key), String(value))
  }
}

function readStorage(target: Window, key: 'localStorage' | 'sessionStorage') {
  try {
    return target[key]
  } catch {
    return null
  }
}

function installStorage(target: Window, key: 'localStorage' | 'sessionStorage') {
  const current = readStorage(target, key)

  if (current && typeof current.clear === 'function' && typeof current.getItem === 'function') {
    return
  }

  Object.defineProperty(target, key, {
    configurable: true,
    value: new MemoryStorage()
  })
}

if (typeof window !== 'undefined') {
  installStorage(window, 'localStorage')
  installStorage(window, 'sessionStorage')
}
