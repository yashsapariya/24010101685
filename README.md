# Support Ticket Management API

A Node.js + Express + SQL Server REST API backend for a company helpdesk system.

## Features

| Feature | Details |
|---|---|
| **Auth** | JWT (Bearer token) + bcrypt password hashing |
| **RBAC** | Three roles: MANAGER · SUPPORT · USER |
| **Tickets** | Full lifecycle: OPEN → IN_PROGRESS → RESOLVED → CLOSED |
| **Status logs** | Every status change recorded in `ticket_status_logs` |
| **Comments** | Create, list, edit, delete with fine-grained access control |
| **Validation** | express-validator on all inputs |
| **Swagger UI** | Live API docs at `/docs` |
| **Pagination** | `?page=&limit=` on GET /tickets |
| **Filtering** | `?status=&priority=` on GET /tickets |

---

## Prerequisites

- Node.js 18+
- SQL Server (local or remote; SQLEXPRESS also works)
- npm

---

## Setup

### 1. Clone / open the project

```
cd SupportTicketManagment
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

Copy `.env.example` to `.env` and fill in your values:

```bash
copy .env.example .env
```

```env
DB_SERVER=localhost
DB_INSTANCE=SQLEXPRESS        # leave blank if using default instance
DB_DATABASE=SupportTicketDB
DB_USER=sa
DB_PASSWORD=your_password
DB_PORT=1433
DB_WINDOWS_AUTH=false         # set true to use Windows Authentication

JWT_SECRET=replace_with_long_random_secret
JWT_EXPIRES_IN=24h

PORT=3000
```

### 4. Create the database

In SQL Server Management Studio (SSMS) or `sqlcmd`:

```sql
CREATE DATABASE SupportTicketDB;
```

### 5. Run the schema

Execute the schema file against your database:

```bash
sqlcmd -S localhost\SQLEXPRESS -d SupportTicketDB -i database/schema.sql
```

Or open `database/schema.sql` in SSMS and run it.

This creates all 5 tables and seeds:
- Roles: MANAGER, SUPPORT, USER
- A default MANAGER account: **admin@example.com** / **Admin1234**

### 6. Start the server

```bash
# Development (auto-restart on changes)
npm run dev

# Production
npm start
```

Server runs at **http://localhost:3000**  
Swagger UI: **http://localhost:3000/docs**

---

## API Endpoints

### Auth
| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/auth/login` | Public | Login, returns JWT token |

### Users (MANAGER only)
| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/users` | MANAGER | Create a new user |
| GET | `/users` | MANAGER | List all users |

### Tickets
| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/tickets` | USER, MANAGER | Create ticket |
| GET | `/tickets` | All roles* | List tickets (scoped by role) |
| PATCH | `/tickets/:id/assign` | MANAGER, SUPPORT | Assign ticket to a MANAGER/SUPPORT user |
| PATCH | `/tickets/:id/status` | MANAGER, SUPPORT | Advance ticket status one step |
| DELETE | `/tickets/:id` | MANAGER | Delete ticket |

\* MANAGER sees all · SUPPORT sees assigned tickets · USER sees own tickets

### Comments
| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/tickets/:id/comments` | Ticket participants | Add comment |
| GET | `/tickets/:id/comments` | Ticket participants | List comments |
| PATCH | `/comments/:id` | Author or MANAGER | Edit comment |
| DELETE | `/comments/:id` | Author or MANAGER | Delete comment |

---

## Status Transition Rules

Status can only advance **one step at a time**:

```
OPEN → IN_PROGRESS → RESOLVED → CLOSED
```

Attempting to skip steps returns **400 Bad Request**.

---

## Testing Flow

1. **Login as MANAGER** (`POST /auth/login`):
   ```json
   { "email": "admin@example.com", "password": "Admin1234" }
   ```
2. Use the returned `token` as `Authorization: Bearer <token>` header in Swagger or any HTTP client.
3. **Create SUPPORT/USER accounts** (`POST /users`).
4. Login as those users to test role-specific flows.
5. Test ticket lifecycle and comment CRUD.

---

## Validation Rules

- `title` minimum 5 characters
- `description` minimum 10 characters
- `priority` must be `LOW`, `MEDIUM`, or `HIGH`
- `status` must be `OPEN`, `IN_PROGRESS`, `RESOLVED`, or `CLOSED`
- Tickets cannot be assigned to users with role `USER`
- Passwords stored as bcrypt hashes (10 rounds)

---

## Project Structure

```
SupportTicketManagment/
├── config/
│   └── db.js              # MSSQL connection pool
├── database/
│   └── schema.sql         # DB schema + seed data
├── middleware/
│   ├── auth.js            # JWT authentication middleware
│   └── roles.js           # RBAC authorization middleware
├── routes/
│   ├── auth.js            # POST /auth/login
│   ├── users.js           # POST/GET /users
│   ├── tickets.js         # Ticket CRUD + assign + status
│   └── comments.js        # Comment CRUD
├── server.js              # App entry point + Swagger setup
├── .env.example
├── package.json
└── README.md
```
