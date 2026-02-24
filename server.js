'use strict';
require('dotenv').config();

const express = require('express');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const ticketsRouter = require('./routes/tickets');
const { ticketCommentRouter, commentRouter } = require('./routes/comments');

const app = express();
app.use(express.json());

const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Support Ticket Management API',
            version: '1.0.0',
            description:
                'Support Ticket Management — Student Project Assignment\n\n' +
                'Overview:\nBuild a backend for a company helpdesk system where employees raise tickets, support staff handle them, and managers track everything.\nThe API follows REST principles.',
        },
        servers: [{ url: `http://localhost:${process.env.PORT || 3001}` }],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
            },
            schemas: {
                LoginDTO: {
                    type: 'object',
                    required: ['email', 'password'],
                    properties: {
                        email: { type: 'string', format: 'email' },
                        password: { type: 'string' },
                    },
                },
                AuthResponse: {
                    type: 'object',
                    properties: {
                        token: { type: 'string' },
                        user: { $ref: '#/components/schemas/User' },
                    },
                },
                Role: {
                    type: 'object',
                    properties: {
                        id: { type: 'integer' },
                        name: { type: 'string', enum: ['MANAGER', 'SUPPORT', 'USER'] },
                    },
                },
                User: {
                    type: 'object',
                    properties: {
                        id: { type: 'integer' },
                        name: { type: 'string' },
                        email: { type: 'string', format: 'email' },
                        role: { $ref: '#/components/schemas/Role' },
                        created_at: { type: 'string', format: 'date-time' },
                    },
                },
                CreateUserDTO: {
                    type: 'object',
                    required: ['name', 'email', 'password', 'role'],
                    properties: {
                        name: { type: 'string' },
                        email: { type: 'string', format: 'email' },
                        password: { type: 'string', minLength: 6 },
                        role: { type: 'string', enum: ['MANAGER', 'SUPPORT', 'USER'] },
                    },
                },
                Ticket: {
                    type: 'object',
                    properties: {
                        id: { type: 'integer' },
                        title: { type: 'string' },
                        description: { type: 'string' },
                        status: { type: 'string', enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] },
                        priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
                        created_by: { $ref: '#/components/schemas/User' },
                        assigned_to: { $ref: '#/components/schemas/User' },
                        created_at: { type: 'string', format: 'date-time' },
                    },
                },
                CreateTicketDTO: {
                    type: 'object',
                    required: ['title', 'description'],
                    properties: {
                        title: { type: 'string', minLength: 5 },
                        description: { type: 'string', minLength: 10 },
                        priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
                    },
                },
                AssignDTO: {
                    type: 'object',
                    required: ['userId'],
                    properties: {
                        userId: { type: 'integer' },
                    },
                },
                UpdateStatusDTO: {
                    type: 'object',
                    required: ['status'],
                    properties: {
                        status: { type: 'string', enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] },
                    },
                },
                TicketComment: {
                    type: 'object',
                    properties: {
                        id: { type: 'integer' },
                        comment: { type: 'string' },
                        user: { $ref: '#/components/schemas/User' },
                        created_at: { type: 'string', format: 'date-time' },
                    },
                },
                CommentDTO: {
                    type: 'object',
                    required: ['comment'],
                    properties: {
                        comment: { type: 'string' },
                    },
                },
            },
        },
    },
    apis: ['./routes/*.js'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/auth', authRouter);
app.use('/users', usersRouter);
app.use('/tickets', ticketsRouter);
app.use('/tickets/:id/comments', ticketCommentRouter);
app.use('/comments', commentRouter);

app.use((req, res) =>
    {
    res.status(404).json({ message: 'Route not found.' });
});

app.use((err, req, res, next) =>
    {
    console.error('Unhandled error:', err);
    res.status(500).json({ message: 'Internal server error.' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () =>
    {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Swagger UI: http://localhost:${PORT}/docs`);
});
