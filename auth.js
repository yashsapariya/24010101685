'use strict';
const jwt = require('jsonwebtoken');

function authenticate(req, res, next)
{
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token)
        {
            return res.status(401).json({ message: 'No token provided. Authorization required.' });
    }

    try
    {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // { id, email, role }
        next();
    }
    catch (err)
    {
        return res.status(401).json({ message: 'Invalid or expired token.' });
    }
}

module.exports = authenticate;
