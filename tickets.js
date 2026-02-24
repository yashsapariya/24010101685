'use strict';
const express = require('express');
const { body, validationResult } = require('express-validator');
const { getPool, sql } = require('../config/db');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roles');

const router = express.Router();


const STATUS_ORDER = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

function userShape(row, prefix = '') {
    if (!row[`${prefix}id`]) return null;
    return {
        id: row[`${prefix}id`],
        name: row[`${prefix}name`],
        email: row[`${prefix}email`],
        role: { id: row[`${prefix}role_id`], name: row[`${prefix}role_name`] },
        created_at: row[`${prefix}created_at`],
    };
}

function ticketShape(row) {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        created_by: {
            id: row.cb_id,
            name: row.cb_name,
            email: row.cb_email,
            role: { id: row.cb_role_id, name: row.cb_role_name },
            created_at: row.cb_created_at,
        },
        assigned_to: row.at_id
            ? {
                id: row.at_id,
                name: row.at_name,
                email: row.at_email,
                role: { id: row.at_role_id, name: row.at_role_name },
                created_at: row.at_created_at,
            }
            : null,
        created_at: row.created_at,
    };
}

const TICKET_SELECT = `
    SELECT
        t.id, t.title, t.description, t.status, t.priority, t.created_at,
        cb.id   AS cb_id,   cb.name AS cb_name,   cb.email AS cb_email,
        cbr.id  AS cb_role_id, cbr.name AS cb_role_name, cb.created_at AS cb_created_at,
        at_.id  AS at_id,   at_.name AS at_name,  at_.email AS at_email,
        atr.id  AS at_role_id, atr.name AS at_role_name, at_.created_at AS at_created_at
    FROM tickets t
    JOIN users   cb  ON cb.id  = t.created_by
    JOIN roles   cbr ON cbr.id = cb.role_id
    LEFT JOIN users  at_  ON at_.id  = t.assigned_to
    LEFT JOIN roles  atr  ON atr.id  = at_.role_id
`;


/**
 * @swagger
 * tags:
 *   name: Tickets
 *   description: Create, view, assign, update status, and delete tickets
 */

/**
 * @swagger
 * /tickets:
 *   post:
 *     tags: [Tickets]
 *     summary: Create ticket (USER, MANAGER)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateTicketDTO'
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Ticket'
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
    authorize('USER', 'MANAGER'),
    [
        body('title').isLength({ min: 5 }).withMessage('Title must be at least 5 characters.'),
        body('description').isLength({ min: 10 }).withMessage('Description must be at least 10 characters.'),
        body('priority')
            .optional()
            .isIn(['LOW', 'MEDIUM', 'HIGH'])
            .withMessage('Priority must be LOW, MEDIUM, or HIGH.'),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { title, description, priority = 'MEDIUM' } = req.body;
        const createdBy = req.user.id;

        try {
            const pool = await getPool();
            const result = await pool
                .request()
                .input('title', sql.NVarChar, title)
                .input('description', sql.NVarChar, description)
                .input('priority', sql.NVarChar, priority)
                .input('created_by', sql.Int, createdBy)
                .query(`
                    INSERT INTO tickets (title, description, priority, created_by)
                    OUTPUT INSERTED.id
                    VALUES (@title, @description, @priority, @created_by)
                `);

            const newId = result.recordset[0].id;

            const ticket = await pool
                .request()
                .input('id', sql.Int, newId)
                .query(`${TICKET_SELECT} WHERE t.id = @id`);

            return res.status(201).json(ticketShape(ticket.recordset[0]));
        } catch (err) {
            console.error('Create ticket error:', err);
            return res.status(500).json({ message: 'Internal server error.' });
        }
    }
);


/**
 * @swagger
 * /tickets:
 *   get:
 *     tags: [Tickets]
 *     summary: Get tickets (MANAGER=all, SUPPORT=assigned, USER=own)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [OPEN, IN_PROGRESS, RESOLVED, CLOSED]
 *         description: Filter by status
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           enum: [LOW, MEDIUM, HIGH]
 *         description: Filter by priority
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number (default 1)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Items per page (default 20)
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Ticket'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get('/', authenticate, authorize('MANAGER', 'SUPPORT', 'USER'), async (req, res) => {
    const { role, id: userId } = req.user;
    const { status, priority, page = 1, limit = 20 } = req.query;

    // Validate optional filter enums
    if (status && !STATUS_ORDER.includes(status)) {
        return res.status(400).json({ message: 'Invalid status filter.' });
    }
    if (priority && !['LOW', 'MEDIUM', 'HIGH'].includes(priority)) {
        return res.status(400).json({ message: 'Invalid priority filter.' });
    }

    const offset = (Math.max(1, parseInt(page)) - 1) * Math.max(1, parseInt(limit));
    const pageSize = Math.min(100, Math.max(1, parseInt(limit)));

    try {
        const pool = await getPool();
        const request = pool.request();

        let whereClause = 'WHERE 1 = 1';

        if (role === 'SUPPORT') {
            whereClause += ' AND t.assigned_to = @userId';
            request.input('userId', sql.Int, userId);
        } else if (role === 'USER') {
            whereClause += ' AND t.created_by = @userId';
            request.input('userId', sql.Int, userId);
        }

        if (status) {
            whereClause += ' AND t.status = @status';
            request.input('status', sql.NVarChar, status);
        }
        if (priority) {
            whereClause += ' AND t.priority = @priority';
            request.input('priority', sql.NVarChar, priority);
        }

        request.input('offset', sql.Int, offset);
        request.input('pageSize', sql.Int, pageSize);

        const result = await request.query(`
            ${TICKET_SELECT}
            ${whereClause}
            ORDER BY t.id DESC
            OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
        `);

        return res.json(result.recordset.map(ticketShape));
    } catch (err) {
        console.error('Get tickets error:', err);
        return res.status(500).json({ message: 'Internal server error.' });
    }
});


/**
 * @swagger
 * /tickets/{id}/assign:
 *   patch:
 *     tags: [Tickets]
 *     summary: Assign ticket (MANAGER, SUPPORT)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AssignDTO'
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Ticket'
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 */
router.patch(
    '/:id/assign',
    authenticate,
    authorize('MANAGER', 'SUPPORT'),
    [body('userId').isInt({ min: 1 }).withMessage('userId must be a positive integer.')],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const ticketId = parseInt(req.params.id, 10);
        const { userId } = req.body;

        try {
            const pool = await getPool();

            // Check ticket exists
            const ticketCheck = await pool
                .request()
                .input('id', sql.Int, ticketId)
                .query('SELECT id FROM tickets WHERE id = @id');
            if (ticketCheck.recordset.length === 0) return res.status(404).json({ message: 'Ticket not found.' });

            // Validate assignee exists and is not a plain USER
            const userCheck = await pool
                .request()
                .input('uid', sql.Int, userId)
                .query(`
                    SELECT u.id, r.name AS role_name
                    FROM users u
                    JOIN roles r ON r.id = u.role_id
                    WHERE u.id = @uid
                `);
            if (userCheck.recordset.length === 0) return res.status(400).json({ message: 'Assignee user not found.' });

            const assignee = userCheck.recordset[0];
            if (assignee.role_name === 'USER') {
                return res.status(400).json({ message: 'Tickets cannot be assigned to users with role USER.' });
            }

            await pool
                .request()
                .input('assigned_to', sql.Int, userId)
                .input('id', sql.Int, ticketId)
                .query('UPDATE tickets SET assigned_to = @assigned_to WHERE id = @id');

            const result = await pool
                .request()
                .input('id', sql.Int, ticketId)
                .query(`${TICKET_SELECT} WHERE t.id = @id`);

            return res.json(ticketShape(result.recordset[0]));
        } catch (err) {
            console.error('Assign ticket error:', err);
            return res.status(500).json({ message: 'Internal server error.' });
        }
    }
);

/**
 * @swagger
 * /tickets/{id}/status:
 *   patch:
 *     tags: [Tickets]
 *     summary: Update ticket status (MANAGER, SUPPORT)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateStatusDTO'
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Ticket'
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 */
router.patch(
    '/:id/status',
    authenticate,
    authorize('MANAGER', 'SUPPORT'),
    [body('status').isIn(STATUS_ORDER).withMessage('Status must be OPEN, IN_PROGRESS, RESOLVED, or CLOSED.')],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const ticketId = parseInt(req.params.id, 10);
        const { status: newStatus } = req.body;

        try {
            const pool = await getPool();

            const ticketCheck = await pool
                .request()
                .input('id', sql.Int, ticketId)
                .query('SELECT id, status FROM tickets WHERE id = @id');
            if (ticketCheck.recordset.length === 0) return res.status(404).json({ message: 'Ticket not found.' });

            const currentStatus = ticketCheck.recordset[0].status;
            const currentIdx = STATUS_ORDER.indexOf(currentStatus);
            const newIdx = STATUS_ORDER.indexOf(newStatus);

            // Only allow forward-by-one transition
            if (newIdx !== currentIdx + 1) {
                return res.status(400).json({
                    message: `Invalid status transition. Current status is '${currentStatus}'. Allowed next: '${STATUS_ORDER[currentIdx + 1] || 'none (already CLOSED)'}'.`,
                });
            }

            // Update ticket status
            await pool
                .request()
                .input('status', sql.NVarChar, newStatus)
                .input('id', sql.Int, ticketId)
                .query('UPDATE tickets SET status = @status WHERE id = @id');

            // Log the status change
            await pool
                .request()
                .input('ticket_id', sql.Int, ticketId)
                .input('old_status', sql.NVarChar, currentStatus)
                .input('new_status', sql.NVarChar, newStatus)
                .input('changed_by', sql.Int, req.user.id)
                .query(`
                    INSERT INTO ticket_status_logs (ticket_id, old_status, new_status, changed_by)
                    VALUES (@ticket_id, @old_status, @new_status, @changed_by)
                `);

            const result = await pool
                .request()
                .input('id', sql.Int, ticketId)
                .query(`${TICKET_SELECT} WHERE t.id = @id`);

            return res.json(ticketShape(result.recordset[0]));
        } catch (err) {
            console.error('Update status error:', err);
            return res.status(500).json({ message: 'Internal server error.' });
        }
    }
);


/**
 * @swagger
 * /tickets/{id}:
 *   delete:
 *     tags: [Tickets]
 *     summary: Delete ticket (MANAGER)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       204:
 *         description: No Content
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 */
router.delete('/:id', authenticate, authorize('MANAGER'), async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);

    try {
        const pool = await getPool();

        const result = await pool
            .request()
            .input('id', sql.Int, ticketId)
            .query('DELETE FROM tickets OUTPUT DELETED.id WHERE id = @id');

        if (result.recordset.length === 0) return res.status(404).json({ message: 'Ticket not found.' });

        return res.status(204).send();
    } catch (err) {
        console.error('Delete ticket error:', err);
        return res.status(500).json({ message: 'Internal server error.' });
    }
});

module.exports = router;
