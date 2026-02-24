'use strict';
const express = require('express');
const { body, validationResult } = require('express-validator');
const { getPool, sql } = require('../config/db');
const authenticate = require('../middleware/auth');

const ticketRouter = express.Router({ mergeParams: true });
const commentRouter = express.Router();

const COMMENT_SELECT = `SELECT
        c.id, c.comment, c.created_at,
        u.id   AS u_id,   u.name  AS u_name,   u.email AS u_email,
        r.id   AS r_id,   r.name  AS r_name,   u.created_at AS u_created_at
    FROM ticket_comments c
    JOIN users u ON u.id = c.user_id
    JOIN roles r ON r.id = u.role_id
`;

function commentShape(row) {
    return {
        id: row.id,
        comment: row.comment,
        user: {
            id: row.u_id,
            name: row.u_name,
            email: row.u_email,
            role: { id: row.r_id, name: row.r_name },
            created_at: row.u_created_at,
        },
        created_at: row.created_at,
    };
}

async function ticketAccess(req, res, next) {
    const ticketId = parseInt(req.params.id, 10);
    const { id: userId, role } = req.user;

    try {
        const pool = await getPool();
        const result = await pool
            .request()
            .input('id', sql.Int, ticketId)
            .query('SELECT id, created_by, assigned_to FROM tickets WHERE id = @id');

        if (result.recordset.length === 0) return res.status(404).json({ message: 'Ticket not found.' });

        const ticket = result.recordset[0];

        if (role === 'MANAGER') return next();
        if (role === 'SUPPORT' && ticket.assigned_to === userId) return next();
        if (role === 'USER' && ticket.created_by === userId) return next();

        return res.status(403).json({ message: 'Forbidden: you do not have access to this ticket.' });
    } catch (err) {
        console.error('ticketAccess error:', err);
        return res.status(500).json({ message: 'Internal server error.' });
    }
}

/**
 * @swagger
 * tags:
 *   name: Comments
 *   description: Add, list, edit, and delete ticket comments
 */

/**
 * @swagger
 * /tickets/{id}/comments:
 *   post:
 *     tags: [Comments]
 *     summary: Add comment to ticket
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
 *             $ref: '#/components/schemas/CommentDTO'
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TicketComment'
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 */
ticketRouter.post(
    '/',
    authenticate,
    ticketAccess,
    [body('comment').notEmpty().withMessage('comment is required.')],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const ticketId = parseInt(req.params.id, 10);
        const { comment } = req.body;

        try {
            const pool = await getPool();
            const result = await pool
                .request()
                .input('ticket_id', sql.Int, ticketId)
                .input('user_id', sql.Int, req.user.id)
                .input('comment', sql.NVarChar, comment)
                .query(`
                    INSERT INTO ticket_comments (ticket_id, user_id, comment)
                    OUTPUT INSERTED.id
                    VALUES (@ticket_id, @user_id, @comment)
                `);

            const newId = result.recordset[0].id;
            const fetched = await pool
                .request()
                .input('id', sql.Int, newId)
                .query(`${COMMENT_SELECT} WHERE c.id = @id`);

            return res.status(201).json(commentShape(fetched.recordset[0]));
        } catch (err) {
            console.error('Add comment error:', err);
            return res.status(500).json({ message: 'Internal server error.' });
        }
    }
);


/**
 * @swagger
 * /tickets/{id}/comments:
 *   get:
 *     tags: [Comments]
 *     summary: List comments for a ticket
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/TicketComment'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 */
ticketRouter.get('/', authenticate, ticketAccess, async (req, res) => {
    const ticketId = parseInt(req.params.id, 10);
    try {
        const pool = await getPool();
        const result = await pool
            .request()
            .input('ticket_id', sql.Int, ticketId)
            .query(`${COMMENT_SELECT} WHERE c.ticket_id = @ticket_id ORDER BY c.id ASC`);

        return res.json(result.recordset.map(commentShape));
    } catch (err) {
        console.error('List comments error:', err);
        return res.status(500).json({ message: 'Internal server error.' });
    }
});

/**
 * @swagger
 * /comments/{id}:
 *   patch:
 *     tags: [Comments]
 *     summary: Edit comment (author or MANAGER)
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
 *             $ref: '#/components/schemas/CommentDTO'
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TicketComment'
 *       400:
 *         description: Bad Request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 */
commentRouter.patch(
    '/:id',
    authenticate,
    [body('comment').notEmpty().withMessage('comment is required.')],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const commentId = parseInt(req.params.id, 10);
        const { comment } = req.body;
        const { id: userId, role } = req.user;

        try {
            const pool = await getPool();
            const existing = await pool
                .request()
                .input('id', sql.Int, commentId)
                .query('SELECT id, user_id FROM ticket_comments WHERE id = @id');

            if (existing.recordset.length === 0) return res.status(404).json({ message: 'Comment not found.' });

            const record = existing.recordset[0];

            if (role !== 'MANAGER' && record.user_id !== userId) {
                return res.status(403).json({ message: 'Forbidden: you can only edit your own comments.' });
            }

            await pool
                .request()
                .input('comment', sql.NVarChar, comment)
                .input('id', sql.Int, commentId)
                .query('UPDATE ticket_comments SET comment = @comment WHERE id = @id');

            const updated = await pool
                .request()
                .input('id', sql.Int, commentId)
                .query(`${COMMENT_SELECT} WHERE c.id = @id`);

            return res.json(commentShape(updated.recordset[0]));
        } catch (err) {
            console.error('Edit comment error:', err);
            return res.status(500).json({ message: 'Internal server error.' });
        }
    }
);


/**
 * @swagger
 * /comments/{id}:
 *   delete:
 *     tags: [Comments]
 *     summary: Delete comment (author or MANAGER)
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
commentRouter.delete('/:id', authenticate, async (req, res) => {
    const commentId = parseInt(req.params.id, 10);
    const { id: userId, role } = req.user;

    try {
        const pool = await getPool();
        const existing = await pool
            .request()
            .input('id', sql.Int, commentId)
            .query('SELECT id, user_id FROM ticket_comments WHERE id = @id');

        if (existing.recordset.length === 0) return res.status(404).json({ message: 'Comment not found.' });

        if (role !== 'MANAGER' && existing.recordset[0].user_id !== userId) {
            return res.status(403).json({ message: 'Forbidden: you can only delete your own comments.' });
        }

        await pool
            .request()
            .input('id', sql.Int, commentId)
            .query('DELETE FROM ticket_comments WHERE id = @id');

        return res.status(204).send();
    } catch (err) {
        console.error('Delete comment error:', err);
        return res.status(500).json({ message: 'Internal server error.' });
    }
});

module.exports = { ticketCommentRouter: ticketRouter, commentRouter };
