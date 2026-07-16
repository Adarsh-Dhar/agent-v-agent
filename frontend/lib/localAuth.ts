// Local authentication system for development without Supabase integration

export interface LocalUser {
  id: string
  email: string
  name: string
  password: string
}

export interface LocalSession {
  user: LocalUser
  token: string
}

const USERS_STORAGE_KEY = 'agent_arena_users'
const SESSION_STORAGE_KEY = 'agent_arena_session'

// Get all stored users
export function getAllUsers(): LocalUser[] {
  if (typeof window === 'undefined') return []
  const usersJson = localStorage.getItem(USERS_STORAGE_KEY)
  return usersJson ? JSON.parse(usersJson) : []
}

// Save users to storage
function saveUsers(users: LocalUser[]): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users))
}

// Generate a simple token
function generateToken(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36)
}

// Hash password (simple, for demo only - not secure for production)
function hashPassword(password: string): string {
  return Buffer.from(password).toString('base64')
}

// Sign up a new user
export function signUpLocal(email: string, name: string, password: string): LocalSession | null {
  const users = getAllUsers()
  
  // Check if user already exists
  if (users.some(u => u.email === email)) {
    throw new Error('User with this email already exists')
  }

  const newUser: LocalUser = {
    id: 'user_' + Date.now(),
    email,
    name,
    password: hashPassword(password),
  }

  users.push(newUser)
  saveUsers(users)

  const token = generateToken()
  const session: LocalSession = { user: newUser, token }
  
  if (typeof window !== 'undefined') {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
  }

  return session
}

// Sign in an existing user
export function signInLocal(email: string, password: string): LocalSession | null {
  const users = getAllUsers()
  const user = users.find(u => u.email === email)

  if (!user || user.password !== hashPassword(password)) {
    throw new Error('Invalid email or password')
  }

  const token = generateToken()
  const session: LocalSession = { user, token }
  
  if (typeof window !== 'undefined') {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
  }

  return session
}

// Get current session
export function getCurrentSession(): LocalSession | null {
  if (typeof window === 'undefined') return null
  const sessionJson = localStorage.getItem(SESSION_STORAGE_KEY)
  return sessionJson ? JSON.parse(sessionJson) : null
}

// Sign out
export function signOutLocal(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(SESSION_STORAGE_KEY)
}

// Get current user
export function getCurrentUser(): LocalUser | null {
  const session = getCurrentSession()
  return session?.user || null
}
