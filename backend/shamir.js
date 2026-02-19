/**
 * Shamir Secret Sharing Implementation for Node.js
 * Matches the Kotlin implementation for cross-platform compatibility
 */

const crypto = require('crypto');
const bigInt = require('big-integer');

class ShamirSecretSharing {
    constructor() {
        // secp256k1 prime
        this.prime = bigInt('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F', 16);
    }

    /**
     * Split a secret into n shares with threshold k
     */
    split(secret, n = 2, k = 2) {
        if (k > n) throw new Error('Threshold k must be <= total shares n');
        if (k < 2) throw new Error('Threshold must be at least 2');

        // Convert secret to BigInteger
        const secretBytes = Buffer.from(secret, 'utf8');
        const secretInt = bigInt(secretBytes.toString('hex'), 16);

        // Generate random coefficients for polynomial
        const coefficients = [secretInt];
        for (let i = 1; i < k; i++) {
            const randomBytes = crypto.randomBytes(32);
            const coeff = bigInt(randomBytes.toString('hex'), 16).mod(this.prime);
            coefficients.push(coeff);
        }

        // Generate shares by evaluating polynomial at x = 1, 2, ..., n
        const shares = [];
        for (let x = 1; x <= n; x++) {
            const xBig = bigInt(x);
            let y = bigInt.zero;

            // Evaluate polynomial: f(x) = a0 + a1*x + a2*x^2 + ... + ak-1*x^(k-1)
            for (let i = 0; i < coefficients.length; i++) {
                const term = coefficients[i].multiply(xBig.pow(i)).mod(this.prime);
                y = y.add(term).mod(this.prime);
            }

            // Share format: "x:y" where y is hex string
            shares.push(`${x}:${y.toString(16)}`);
        }

        return shares;
    }

    /**
     * Combine shares to reconstruct the secret
     */
    combine(shares) {
        if (shares.length < 2) throw new Error('At least 2 shares required');

        // Parse shares
        const points = shares.map(share => {
            const parts = share.split(':');
            if (parts.length !== 2) throw new Error(`Invalid share format: ${share}`);
            const x = bigInt(parts[0]);
            const y = bigInt(parts[1], 16);
            return { x, y };
        });

        // Use Lagrange interpolation to find f(0) = secret
        let secret = bigInt.zero;

        for (let i = 0; i < points.length; i++) {
            const { x: xi, y: yi } = points[i];
            let numerator = bigInt.one;
            let denominator = bigInt.one;

            for (let j = 0; j < points.length; j++) {
                if (i !== j) {
                    const { x: xj } = points[j];
                    // numerator *= (0 - xj)
                    numerator = numerator.multiply(bigInt.zero.subtract(xj)).mod(this.prime);
                    // denominator *= (xi - xj)
                    denominator = denominator.multiply(xi.subtract(xj)).mod(this.prime);
                }
            }

            // Calculate modular inverse of denominator
            const denomInverse = denominator.modInv(this.prime);
            const lagrange = numerator.multiply(denomInverse).mod(this.prime);

            // Add this term to the secret
            secret = secret.add(yi.multiply(lagrange)).mod(this.prime);
        }

        secret = secret.mod(this.prime);

        // Convert back to string
        let hexSecret = secret.toString(16);
        // Ensure even length for Buffer.from
        if (hexSecret.length % 2 !== 0) {
            hexSecret = '0' + hexSecret;
        }

        const secretBytes = Buffer.from(hexSecret, 'hex');
        return secretBytes.toString('utf8');
    }

    /**
     * Generate a random password
     */
    static generateRandomPassword(length = 32) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
        let password = '';
        const randomBytes = crypto.randomBytes(length);

        for (let i = 0; i < length; i++) {
            password += chars[randomBytes[i] % chars.length];
        }

        return password;
    }
}

module.exports = new ShamirSecretSharing();
