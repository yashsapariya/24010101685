'use strict';

/**
 * Factory that returns middleware allowing only specified roles.
 * @param  {...string} roles - Allowed role names, e.g. 'MANAGER', 'SUPPORT'
 */
function authorize(...roles)
{
    return (req, res, next) =>
        {
            if (!req.user)
                {
                    return res.status(401).json({ message: 'Not authenticated.' });
                }

            if (!roles.includes(req.user.role))
                {
                    return res.status(403).json({ message: 'Forbidden: insufficient permissions.' });
                }
            next();
        };
}

module.exports = authorize;
