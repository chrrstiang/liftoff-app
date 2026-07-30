/** This mapping contains all valid columns accessible through GET /athlete/profile
 * in relation to an athlete row in the 'athletes' table. property.value combinations
 * are the only valid queries for GET /athlete/profile, along with VALID_FULL_TABLE_QUERIES
 *
 */
export const VALID_TABLE_FIELDS = {
  // Only these user fields are allowed. Keep this list minimal — it is the only
  // thing constraining what this endpoint exposes, since the backend's
  // service-role key bypasses RLS.
  users: ['first_name', 'last_name', 'username', 'email', 'role', 'gender'],
  federations: ['id', 'name', 'code'],
  divisions: ['id', 'federation_id', 'name', 'minimum_age', 'maximum_age'],
  weight_classes: [
    'id',
    'federation_id',
    'name',
    'gender',
    'min_weight',
    'max_weight',
    'sort_order',
    'active',
  ],
};

/** This set contains all valid queries for selecting a full row of a reletional
 * table for an athlete. All columns in the listed tables are accessible through
 * GET /athlete/profile
 *
 */
export const VALID_FULL_TABLE_QUERIES = new Set(['federations', 'divisions', 'weight_classes']);

/** This set contains the accessible fields of the 'athletes' record that is being queried.
 * Includes all columns besides 'user_id', as this can be used to access the auth.uid() of a user.
 *
 */
export const VALID_ATHLETES_COLUMNS_QUERIES = new Set([
  'id',
  'federation_id',
  'division_id',
  'weight_class_id',
  'team_id',
  'coach_id',
]);

/** The default select used when GET /athlete/profile/:id is called with no `data` param.
 *
 * Only reference columns that are definitely populated — this query must not fail.
 * `role` and `email` are intentionally absent: nothing in the app writes `role`, so it
 * stays opt-in via ?data= rather than breaking the default response.
 */
export const PUBLIC_PROFILE_QUERY = `id, users (first_name, last_name, username, gender), federations (*), divisions (*), weight_classes (*)`;
