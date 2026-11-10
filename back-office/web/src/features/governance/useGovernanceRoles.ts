// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { useEffect, useState } from 'react';
import { governanceRoles } from '../../shared/api/governance.ts';

/**
 * Load the operator backend roles and retain the current selected role.
 * @returns The loaded backend roles, current role and its setter.
 */
export default function useGovernanceRoles() {
  const [roles, setRoles] = useState(null);
  const [role, setRole] = useState('');

  useEffect(() => {
    let alive = true;
    governanceRoles()
      .then((nextRoles) => {
        if (!alive) return;
        setRoles(nextRoles);
        setRole((current) => current || nextRoles.roles[0] || '');
      })
      .catch(
        (e) => alive && setRoles({ enabled: false, roles: [], addresses: {}, error: e.message }),
      );
    return () => {
      alive = false;
    };
  }, []);

  return { roles, role, setRole };
}
