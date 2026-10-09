// Client-side preview of the password policy (the server enforces it — PLAN.md §6B-3).
export function passwordProblems(pw: string, username: string): string[] {
  const p: string[] = []
  if (pw.length < 10) p.push('at least 10 characters')
  if (!/[A-Z]/.test(pw)) p.push('an uppercase letter')
  if (!/[a-z]/.test(pw)) p.push('a lowercase letter')
  if (!/\d/.test(pw)) p.push('a digit')
  if (username && pw.toLowerCase().includes(username.toLowerCase())) p.push('not containing your username')
  return p
}
