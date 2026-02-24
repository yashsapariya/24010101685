'use strict';

const BASE = process.env.BASE_URL || 'http://localhost:3001';

const green = (s) => `\x1b[32m✔ ${s}\x1b[0m`;
const red = (s) => `\x1b[31m✘ ${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m• ${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

let passed = 0;
let failed = 0;
const errors = [];

function expect(label, actual, expectedStatus, check = null) {
    const ok = actual.status === expectedStatus && (check ? check(actual.body) : true);
    if (ok) {
        console.log(green(`${label}  [${actual.status}]`));
        passed++;
    } else {
        const msg = `${label} — expected HTTP ${expectedStatus}, got ${actual.status}` +
            (check && actual.status === expectedStatus ? ' (body check failed)' : '');
        console.log(red(msg));
        console.log('   Body:', JSON.stringify(actual.body).slice(0, 200));
        failed++;
        errors.push(msg);
    }
    return actual.body;
}

async function api(method, path, body = null, token = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });

    let resBody;
    const ct = res.headers.get('content-type') || '';
    try {
        resBody = ct.includes('json') ? await res.json() : await res.text();
    } catch {
        resBody = null;
    }
    return { status: res.status, body: resBody };
}

async function run() {
    console.log(bold('\n=== Support Ticket Management – API Test Suite ===\n'));

    // ── 1. Auth ──────────────────────────────────────────────────────────────
    console.log(bold('── 1. Authentication ──'));

    // 1a. Bad credentials
    let r = await api('POST', '/auth/login', { email: 'nobody@x.com', password: 'wrong' });
    expect('Reject unknown credentials (401)', r, 401);

    // 1b. Valid MANAGER login
    r = await api('POST', '/auth/login', { email: 'admin@example.com', password: 'Admin1234' });
    const mgrToken = expect('MANAGER login (200)', r, 200, (b) => !!b.token)?.token;
    if (!mgrToken) { console.log(red('Cannot proceed without MANAGER token.')); return summary(); }

    // 1c. No token → 401
    r = await api('GET', '/users');
    expect('No token → 401', r, 401);

    // ── 2. User management 
    console.log(bold('\n── 2. User Management ──'));

    const ts = Date.now();
    // Create SUPPORT user
    r = await api('POST', '/users',
        { name: 'Support Agent', email: `support_${ts}@example.com`, password: 'Pass1234', role: 'SUPPORT' },
        mgrToken
    );
    const supportUser = expect('Create SUPPORT user (201)', r, 201, (b) => b.id > 0);
    const supportEmail = `support_${ts}@example.com`;

    // Create regular USER
    r = await api('POST', '/users',
        { name: 'Regular User', email: `user_${ts}@example.com`, password: 'Pass1234', role: 'USER' },
        mgrToken
    );
    const regularUser = expect('Create USER account (201)', r, 201, (b) => b.id > 0);
    const regularEmail = `user_${ts}@example.com`;

    // Duplicate email
    r = await api('POST', '/users',
        { name: 'Dup', email: `support_${ts}@example.com`, password: 'Pass1234', role: 'SUPPORT' },
        mgrToken
    );
    expect('Duplicate email → 400', r, 400);

    // List users
    r = await api('GET', '/users', null, mgrToken);
    expect('List users (200)', r, 200, (b) => Array.isArray(b));

    // ── 3. Get tokens for SUPPORT and USER 
    r = await api('POST', '/auth/login', { email: supportEmail, password: 'Pass1234' });
    const supportToken = expect('SUPPORT login (200)', r, 200, (b) => !!b.token)?.token;

    r = await api('POST', '/auth/login', { email: regularEmail, password: 'Pass1234' });
    const userToken = expect('USER login (200)', r, 200, (b) => !!b.token)?.token;

    // ── 4. Tickets 
    console.log(bold('\n── 4. Tickets ──'));

    // Create ticket as USER
    r = await api('POST', '/tickets',
        { title: 'Printer is broken', description: 'The 3rd floor printer won\'t print anything.', priority: 'HIGH' },
        userToken
    );
    const ticket = expect('USER creates ticket (201)', r, 201, (b) => b.id > 0);
    const ticketId = ticket?.id;

    // Validate title too short
    r = await api('POST', '/tickets',
        { title: 'Hi', description: 'Short title ticket.' },
        userToken
    );
    expect('Short title → 400', r, 400);

    // Validate description too short
    r = await api('POST', '/tickets',
        { title: 'Valid Title', description: 'Too short.' },
        userToken
    );
    expect('Short description → 400', r, 400);

    // SUPPORT cannot create tickets (403)
    r = await api('POST', '/tickets',
        { title: 'SUPPORT ticket', description: 'This should not be allowed at all.' },
        supportToken
    );
    expect('SUPPORT creates ticket → 403', r, 403);

    // USER gets own tickets
    r = await api('GET', '/tickets', null, userToken);
    expect('USER lists own tickets (200)', r, 200, (b) => Array.isArray(b));

    // SUPPORT gets assigned tickets (empty for now)
    r = await api('GET', '/tickets', null, supportToken);
    expect('SUPPORT lists assigned tickets (200)', r, 200, (b) => Array.isArray(b));

    // MANAGER gets all
    r = await api('GET', '/tickets', null, mgrToken);
    expect('MANAGER lists all tickets (200)', r, 200, (b) => Array.isArray(b));

    // Filtering and pagination
    r = await api('GET', '/tickets?status=OPEN&priority=HIGH&page=1&limit=5', null, mgrToken);
    expect('GET /tickets with filters (200)', r, 200, (b) => Array.isArray(b));

    // ── 5. Assign ticket 
    console.log(bold('\n── 5. Assign Ticket ──'));

    if (ticketId && supportUser?.id) {
        // Assign to SUPPORT user
        r = await api('PATCH', `/tickets/${ticketId}/assign`, { userId: supportUser.id }, mgrToken);
        expect('MANAGER assigns ticket to SUPPORT (200)', r, 200, (b) => b.assigned_to?.id === supportUser.id);

        // Cannot assign to a USER-role account
        if (regularUser?.id) {
            r = await api('PATCH', `/tickets/${ticketId}/assign`, { userId: regularUser.id }, mgrToken);
            expect('Assign to USER role → 400', r, 400);
        }

        // 404 for non-existent ticket
        r = await api('PATCH', '/tickets/999999/assign', { userId: supportUser.id }, mgrToken);
        expect('Assign non-existent ticket → 404', r, 404);
    }

    // ── 6. Status transitions 
    console.log(bold('\n── 6. Status Transitions ──'));

    if (ticketId) {
        // Skip OPEN→RESOLVED (invalid)
        r = await api('PATCH', `/tickets/${ticketId}/status`, { status: 'RESOLVED' }, mgrToken);
        expect('OPEN → RESOLVED (skip) → 400', r, 400);

        // OPEN → IN_PROGRESS  ✓
        r = await api('PATCH', `/tickets/${ticketId}/status`, { status: 'IN_PROGRESS' }, mgrToken);
        expect('OPEN → IN_PROGRESS (200)', r, 200, (b) => b.status === 'IN_PROGRESS');

        // IN_PROGRESS → OPEN (backward) → 400
        r = await api('PATCH', `/tickets/${ticketId}/status`, { status: 'OPEN' }, mgrToken);
        expect('IN_PROGRESS → OPEN (backward) → 400', r, 400);

        // IN_PROGRESS → RESOLVED ✓
        r = await api('PATCH', `/tickets/${ticketId}/status`, { status: 'RESOLVED' }, supportToken);
        expect('IN_PROGRESS → RESOLVED (SUPPORT) (200)', r, 200, (b) => b.status === 'RESOLVED');

        // RESOLVED → CLOSED ✓
        r = await api('PATCH', `/tickets/${ticketId}/status`, { status: 'CLOSED' }, mgrToken);
        expect('RESOLVED → CLOSED (200)', r, 200, (b) => b.status === 'CLOSED');

        // CLOSED → anything → 400
        r = await api('PATCH', `/tickets/${ticketId}/status`, { status: 'CLOSED' }, mgrToken);
        expect('CLOSED → CLOSED (no-op, invalid) → 400', r, 400);
    }

    // ── 7. Comments 
    console.log(bold('\n── 7. Comments ──'));

    // Create a fresh ticket for comment testing
    r = await api('POST', '/tickets',
        { title: 'Comment test ticket', description: 'Testing comments on this ticket.', priority: 'LOW' },
        userToken
    );
    const commentTicket = expect('Create ticket for comment tests (201)', r, 201);
    const ctId = commentTicket?.id;

    if (ctId) {
        // Owner (USER) adds comment
        r = await api('POST', `/tickets/${ctId}/comments`, { comment: 'Hello from user!' }, userToken);
        const comment = expect('USER adds comment (201)', r, 201, (b) => b.id > 0);
        const commentId = comment?.id;

        // MANAGER adds comment
        r = await api('POST', `/tickets/${ctId}/comments`, { comment: 'Manager note here.' }, mgrToken);
        expect('MANAGER adds comment (201)', r, 201);

        // Unrelated SUPPORT cannot comment (no access to this ticket)
        r = await api('POST', `/tickets/${ctId}/comments`, { comment: 'Should fail.' }, supportToken);
        expect('Unassigned SUPPORT adds comment → 403', r, 403);

        // List comments
        r = await api('GET', `/tickets/${ctId}/comments`, null, userToken);
        expect('USER lists comments (200)', r, 200, (b) => Array.isArray(b));

        if (commentId) {
            // Edit own comment
            r = await api('PATCH', `/comments/${commentId}`, { comment: 'Edited by user!' }, userToken);
            expect('USER edits own comment (200)', r, 200, (b) => b.comment === 'Edited by user!');

            // SUPPORT cannot edit user's comment
            r = await api('PATCH', `/comments/${commentId}`, { comment: 'Try to edit.' }, supportToken);
            expect('SUPPORT edits other comment → 403', r, 403);

            // MANAGER can edit any comment
            r = await api('PATCH', `/comments/${commentId}`, { comment: 'Manager override.' }, mgrToken);
            expect('MANAGER edits any comment (200)', r, 200);

            // Delete comment
            r = await api('DELETE', `/comments/${commentId}`, null, userToken);
            expect('USER deletes own comment (204)', r, 204);

            // Already deleted → 404
            r = await api('DELETE', `/comments/${commentId}`, null, mgrToken);
            expect('Delete already-deleted comment → 404', r, 404);
        }
    }

    // ── 8. Delete ticket 
    console.log(bold('\n── 8. Delete Ticket ──'));

    if (ctId) {
        // USER cannot delete
        r = await api('DELETE', `/tickets/${ctId}`, null, userToken);
        expect('USER deletes ticket → 403', r, 403);

        // MANAGER deletes
        r = await api('DELETE', `/tickets/${ctId}`, null, mgrToken);
        expect('MANAGER deletes ticket (204)', r, 204);

        // 404 after deletion
        r = await api('DELETE', `/tickets/${ctId}`, null, mgrToken);
        expect('Delete already-deleted ticket → 404', r, 404);
    }

    summary();
}

function summary() {
    const total = passed + failed;
    console.log(bold(`\n═`));
    console.log(bold(`Results: ${passed}/${total} passed, ${failed} failed`));
    if (errors.length) {
        console.log('\nFailed tests:');
        errors.forEach((e) => console.log(red(e)));
    }
    console.log(bold(`══\n`));
    process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
    console.error(red('Fatal error (is the server running?):'), err.message);
    process.exit(1);
});
