import { applyTransform } from '../orchestrator/transform'

describe('applyTransform', () => {
  describe('field_mapping', () => {
    it('maps nested fields to new structure', async () => {
      const result = await applyTransform(
        {
          type: 'field_mapping',
          mappings: [
            { from: '$.user.name', to: '$.displayName' },
            { from: '$.user.email', to: '$.contact.email' },
          ],
        },
        { user: { name: 'Alice', email: 'alice@example.com' } },
      )
      expect(result).toEqual({
        displayName: 'Alice',
        contact: { email: 'alice@example.com' },
      })
    })

    it('returns input unchanged when no mappings', async () => {
      const input = { a: 1 }
      const result = await applyTransform({ type: 'field_mapping' }, input)
      expect(result).toBe(input)
    })
  })

  describe('jmespath', () => {
    it('extracts value with expression', async () => {
      const result = await applyTransform(
        { type: 'jmespath', expression: 'items[0].name' },
        { items: [{ name: 'foo' }, { name: 'bar' }] },
      )
      expect(result).toBe('foo')
    })

    it('returns null on invalid expression result', async () => {
      const result = await applyTransform(
        { type: 'jmespath', expression: 'missing.deeply.nested' },
        { a: 1 },
      )
      expect(result).toBeNull()
    })
  })

  describe('template (Handlebars)', () => {
    it('renders template with data', async () => {
      const result = await applyTransform(
        { type: 'template', template: '{"hello": "{{data.name}}"}' },
        { name: 'World' },
      )
      expect(result).toEqual({ hello: 'World' })
    })

    it('returns rendered string when not valid JSON', async () => {
      const result = await applyTransform(
        { type: 'template', template: 'Hello {{data.name}}' },
        { name: 'World' },
      )
      expect(result).toBe('Hello World')
    })
  })

  describe('sandbox_js', () => {
    it('executes script with access to input', async () => {
      const result = await applyTransform(
        { type: 'sandbox_js', script: 'return { doubled: input.value * 2 }' },
        { value: 21 },
      )
      expect(result).toEqual({ doubled: 42 })
    })

    it('sandboxes the script — no host globals leaked', async () => {
      // process should not be accessible inside QuickJS sandbox
      const result = await applyTransform(
        {
          type: 'sandbox_js',
          script: 'return typeof process !== "undefined" ? process.env : "sandboxed"',
        },
        {},
      )
      expect(result).toBe('sandboxed')
    })

    it('enforces 100ms CPU time limit', async () => {
      // An infinite loop must be interrupted
      const result = await applyTransform(
        { type: 'sandbox_js', script: 'while(true){} return 1' },
        {},
      )
      // Should return input (null-ish or the original) rather than hanging forever
      expect(result).toBeNull()
    }, 5000)

    it('returns null on script syntax error', async () => {
      const result = await applyTransform(
        { type: 'sandbox_js', script: 'return {{{' },
        {},
      )
      expect(result).toBeNull()
    })
  })
})
