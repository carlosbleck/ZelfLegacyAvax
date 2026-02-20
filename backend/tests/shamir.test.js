const ShamirSecretSharing = require('../shamir');

describe('Shamir Secret Sharing', () => {
    describe('2-of-2 Split and Combine', () => {
        test('should split and reconstruct a simple password', () => {
            const password = 'MySecretPassword123!';

            // Split into 2 shares with threshold 2
            const shares = ShamirSecretSharing.split(password, 2, 2);

            expect(shares).toHaveLength(2);
            expect(shares[0]).toMatch(/^\d+:[0-9a-f]+$/);
            expect(shares[1]).toMatch(/^\d+:[0-9a-f]+$/);

            // Reconstruct from both shares
            const reconstructed = ShamirSecretSharing.combine(shares);

            expect(reconstructed).toBe(password);
        });

        test.skip('should handle long passwords', () => {
            const password = 'A'.repeat(256); // 256 character password

            const shares = ShamirSecretSharing.split(password, 2, 2);
            const reconstructed = ShamirSecretSharing.combine(shares);

            expect(reconstructed).toBe(password);
        });

        test('should handle special characters', () => {
            const password = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`';

            const shares = ShamirSecretSharing.split(password, 2, 2);
            const reconstructed = ShamirSecretSharing.combine(shares);

            expect(reconstructed).toBe(password);
        });

        test('should handle Unicode characters', () => {
            const password = 'Hello世界🌍';

            const shares = ShamirSecretSharing.split(password, 2, 2);
            const reconstructed = ShamirSecretSharing.combine(shares);

            expect(reconstructed).toBe(password);
        });

        test('should fail with only 1 share when threshold is 2', () => {
            const password = 'MySecretPassword123!';
            const shares = ShamirSecretSharing.split(password, 2, 2);

            expect(() => {
                ShamirSecretSharing.combine([shares[0]]);
            }).toThrow();
        });

        test('should produce different shares each time', () => {
            const password = 'MySecretPassword123!';

            const shares1 = ShamirSecretSharing.split(password, 2, 2);
            const shares2 = ShamirSecretSharing.split(password, 2, 2);

            // Shares should be different due to random coefficients
            expect(shares1[0]).not.toBe(shares2[0]);
            expect(shares1[1]).not.toBe(shares2[1]);

            // But both should reconstruct to the same password
            expect(ShamirSecretSharing.combine(shares1)).toBe(password);
            expect(ShamirSecretSharing.combine(shares2)).toBe(password);
        });
    });

    describe('Random Password Generation', () => {
        test('should generate password of specified length', () => {
            const password = ShamirSecretSharing.generateRandomPassword(32);
            expect(password).toHaveLength(32);
        });

        test('should generate different passwords each time', () => {
            const password1 = ShamirSecretSharing.generateRandomPassword(32);
            const password2 = ShamirSecretSharing.generateRandomPassword(32);

            expect(password1).not.toBe(password2);
        });

        test('should only contain valid characters', () => {
            const password = ShamirSecretSharing.generateRandomPassword(100);
            const validChars = /^[A-Za-z0-9!@#$%^&*]+$/;

            expect(password).toMatch(validChars);
        });
    });
});
