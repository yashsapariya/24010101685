
-- 1. roles
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'roles')
BEGIN
    CREATE TABLE roles (
        id   INT           IDENTITY(1,1) PRIMARY KEY,
        name NVARCHAR(20)  NOT NULL UNIQUE
            CHECK (name IN ('MANAGER','SUPPORT','USER'))
    );
END;

-- Seed roles
IF NOT EXISTS (SELECT 1 FROM roles WHERE name = 'MANAGER')
    INSERT INTO roles (name) VALUES ('MANAGER');
IF NOT EXISTS (SELECT 1 FROM roles WHERE name = 'SUPPORT')
    INSERT INTO roles (name) VALUES ('SUPPORT');
IF NOT EXISTS (SELECT 1 FROM roles WHERE name = 'USER')
    INSERT INTO roles (name) VALUES ('USER');

-- 2. users
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'users')
BEGIN
    CREATE TABLE users (
        id         INT            IDENTITY(1,1) PRIMARY KEY,
        name       NVARCHAR(255)  NOT NULL,
        email      NVARCHAR(255)  NOT NULL UNIQUE,
        password   NVARCHAR(255)  NOT NULL,   -- bcrypt hash
        role_id    INT            NOT NULL REFERENCES roles(id),
        created_at DATETIME2      NOT NULL DEFAULT GETDATE()
    );
END;

-- 3. tickets
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'tickets')
BEGIN
    CREATE TABLE tickets (
        id          INT            IDENTITY(1,1) PRIMARY KEY,
        title       NVARCHAR(255)  NOT NULL,
        description NVARCHAR(MAX)  NOT NULL,
        status      NVARCHAR(20)   NOT NULL DEFAULT 'OPEN'
            CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')),
        priority    NVARCHAR(10)   NOT NULL DEFAULT 'MEDIUM'
            CHECK (priority IN ('LOW','MEDIUM','HIGH')),
        created_by  INT            NOT NULL REFERENCES users(id),
        assigned_to INT            NULL     REFERENCES users(id),
        created_at  DATETIME2      NOT NULL DEFAULT GETDATE()
    );
END;

-- 4. ticket_comments
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ticket_comments')
BEGIN
    CREATE TABLE ticket_comments (
        id         INT            IDENTITY(1,1) PRIMARY KEY,
        ticket_id  INT            NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        user_id    INT            NOT NULL REFERENCES users(id),
        comment    NVARCHAR(MAX)  NOT NULL,
        created_at DATETIME2      NOT NULL DEFAULT GETDATE()
    );
END;

-- 5. ticket_status_logs
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ticket_status_logs')
BEGIN
    CREATE TABLE ticket_status_logs (
        id         INT           IDENTITY(1,1) PRIMARY KEY,
        ticket_id  INT           NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        old_status NVARCHAR(20)  NOT NULL
            CHECK (old_status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')),
        new_status NVARCHAR(20)  NOT NULL
            CHECK (new_status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')),
        changed_by INT           NOT NULL REFERENCES users(id),
        changed_at DATETIME2     NOT NULL DEFAULT GETDATE()
    );
END;

IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'admin@example.com')
BEGIN
    DECLARE @mgr_role INT = (SELECT id FROM roles WHERE name = 'MANAGER');
    INSERT INTO users (name, email, password, role_id)
    VALUES (
        'Admin Manager',
        'admin@example.com',
        '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        @mgr_role
    );
END;
