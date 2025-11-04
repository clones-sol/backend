export const coerceDecimalValue = (value: unknown): number => {
    if (typeof value === 'number') {
        return value
    }

    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value)
        return Number.isNaN(parsed) ? 0 : parsed
    }

    if (value !== null && typeof value === 'object' && 'toString' in value) {
        const stringified = (value as { toString: () => string }).toString()
        const parsed = Number.parseFloat(stringified)
        return Number.isNaN(parsed) ? 0 : parsed
    }

    return 0
}

