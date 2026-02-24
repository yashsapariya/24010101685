'use strict';
const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const { getPool, sql } = require('../config/db');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roles');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: User management (MANAGER only)
 */

/**
 * @swagger
 * /users:
 *   post:
 *     tags: [Users]
 *     summary: Create user (MANAGER)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateUserDTO'
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post(
    '/',
    authenticate,
    authorize('MANAGER'),
    [
        body('name').notEmpty().withMessage('Name is required.'),
        body('email').isEmail().withMessage('Valid email required.'),
        body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters.'),
        body('role').isIn(['MANAGER', 'SUPPORT', 'USER']).withMessage('Role must be MANAGER, SUPPORT, or USER.'),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { name, email, password, role } = req.body;

        try {
            const pool = await getPool();

            // Check duplicate email
            const dup = await pool
                .request()
                .input('email', sql.NVarChar, email)
                .query('SELECT id FROM users WHERE email = @email');
            if (dup.recordset.length > 0) {
                return res.status(400).json({ message: 'Email already in use.' });
            }

            // Fetch role id
            const roleResult = await pool
                .request()
                .input('roleName', sql.NVarChar, role)
                .query('SELECT id FROM roles WHERE name = @roleName');
            if (roleResult.recordset.length === 0) {
                return res.status(400).json({ message: 'Invalid role.' });
            }
            const roleId = roleResult.recordset[0].id;

            const hashedPassword = await bcrypt.hash(password, 10);

            const result = await pool
                .request()
                .input('name', sql.NVarChar, name)
                .input('email', sql.NVarChar, email)
                .input('password', sql.NVarChar, hashedPassword)
                .input('role_id', sql.Int, roleId)
                .query(`
          INSERT INTO users (name, email, password, role_id)
          OUTPUT INSERTED.id, INSERTED.name, INSERTED.email, INSERTED.created_at
          VALUES (@name, @email, @password, @role_id)
        `);

            const user = result.recordset[0];

            return res.status(201).json({
                id: user.id,
                name: user.name,
                email: user.email,
                role: { id: roleId, name: role },
                created_at: user.created_at,
            });
        } catch (err) {
            console.error('Create user error:', err);
            return res.status(500).json({ message: 'Internal server error.' });
        }
    }
);

/**
 * @swagger
 * /users:
 *   get:
 *     tags: [Users]
 *     summary: List users (MANAGER)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get('/', authenticate, authorize('MANAGER'), async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
      SELECT u.id, u.name, u.email, u.created_at, r.id AS role_id, r.name AS role_name
      FROM users u
      JOIN roles r ON u.role_id = r.id
      ORDER BY u.id
    `);

        const users = result.recordset.map((row) => ({
            id: row.id,
            name: row.name,
            email: row.email,
            role: { id: row.role_id, name: row.role_name },
            created_at: row.created_at,
        }));

        return res.json(users);
    } catch (err) {
        console.error('List users error:', err);
        return res.status(500).json({ message: 'Internal server error.' });
    }
});

module.exports = router;
