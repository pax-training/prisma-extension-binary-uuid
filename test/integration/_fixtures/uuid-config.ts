/**
 * UUID config for the integration test schema. Hand-written to match
 * prisma/schema.prisma. Also serves as a reference for the CLI `init`
 * output shape.
 */

import { defineBinaryUuidConfig } from '../../../src/config/define-config.js';

export const uuidConfig = defineBinaryUuidConfig({
  fields: {
    User: ['id', 'storageId', 'companyId'],
    Company: ['id'],
    Post: ['id', 'authorId'],
    Profile: ['id', 'userId'],
    Tag: ['id'],
    PostTag: ['postId', 'tagId'],
  },
  autoGenerate: {
    User: ['id', 'storageId'],
    Company: ['id'],
    Post: ['id'],
    Profile: ['id'],
    Tag: ['id'],
  },
  relations: {
    User: { company: 'Company', posts: 'Post', profile: 'Profile' },
    Company: { users: 'User' },
    Post: { author: 'User', tags: 'PostTag' },
    Profile: { user: 'User' },
    Tag: { posts: 'PostTag' },
    PostTag: { post: 'Post', tag: 'Tag' },
  },
});
