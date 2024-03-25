const mongoose = require('mongoose');
const passport = require('passport');
const asyncHandler = require('express-async-handler');
const { body, param, query, validationResult } = require('express-validator');

const {
  topicNameQuerySanitizer,
  isDbIdValid,
  topicSanitizer,
} = require('../utils/validation');
const { generalResourceQueries } = require('../middlewares/queryValidators');

const Post = require('../models/post');
const User = require('../models/user');
const Topic = require('../models/topic');

require('dotenv').config();

const MAX_DOCS_PER_FETCH = parseInt(process.env.MAX_DOCS_PER_FETCH, 10);

exports.posts_get = [
  generalResourceQueries(MAX_DOCS_PER_FETCH),
  query('topic', 'Topic must be valid')
    .optional()
    .trim()
    .escape()
    .customSanitizer(topicNameQuerySanitizer(Topic)),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      res.status(400).json({ message: 'Validation error', errors: errors.array() });
    } else {
      const { page, limit, topic, userid, random } = req.query;

      let posts = [];

      if (random) {
        posts = await Post.aggregate([
          { $sample: { size: +random } },
          { $limit: +limit },
          { $skip: page * MAX_DOCS_PER_FETCH },
          {
            $lookup: {
              from: User.collection.name,
              localField: 'author',
              foreignField: '_id',
              pipeline: [{ $project: { username: 1, profile_image: 1 } }],
              as: 'author',
            },
          },
          { $unwind: '$author' },
          {
            $lookup: {
              from: Topic.collection.name,
              localField: 'topic',
              foreignField: '_id',
              pipeline: [{ $project: { name: 1 } }],
              as: 'topic',
            },
          },
          { $unwind: '$topic' },
        ])
          .project('author title body date topic like_count thumbnail_image')
          .exec();
      } else {
        const queryOpts = {};

        if (topic) queryOpts['topic'] = topic;
        if (userid) queryOpts['author'] = userid;

        posts = await Post.find(
          queryOpts,
          'author title body date topic like_count thumbnail_image'
        )
          .skip(page * MAX_DOCS_PER_FETCH)
          .limit(limit)
          .populate('author', 'username profile_image')
          .populate('topic', 'name')
          .sort({ date: -1 })
          .exec();
      }

      res.json(posts);
    }
  }),
];

exports.post_get = [
  param('postid', 'Post id must be valid').trim().custom(isDbIdValid).escape(),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      res.status(400).json({ message: 'Validation error', errors: errors.array() });
    } else {
      const post = await Post.findById(
        req.params.postid,
        'author title body date topic like_count thumbnail_image'
      )
        .populate('author', 'username profile_image')
        .populate({
          path: 'comments',
          populate: {
            path: 'author',
            model: 'User',
            select: 'username profile_image',
          },
        })
        .populate('topic', 'name')
        .exec();

      if (!post) {
        res.status(404).json({ message: 'Post not found' });
      } else {
        res.json(post);
      }
    }
  }),
];

exports.post_post = [
  passport.authenticate('jwt', { session: false }),
  body('title', 'Title must have correct length').trim().isLength({ min: 3, max: 100 }),
  body('body', 'Post body must have correct length')
    .trim()
    .isLength({ min: 100, max: 10000 }),
  body('topic', 'Topic must be valid').trim().customSanitizer(topicSanitizer).escape(),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      res.status(400).json({ message: 'Validation error', errors: errors.array() });
    } else {
      const user = req.user;

      const postDetail = {
        author: user._id,
        title: req.body.title,
        body: req.body.body,
        topic: req.body.topic,
        date: new Date(),
      };

      const newPost = new Post(postDetail);
      const savedPost = await newPost.save();

      user.user_posts.push(savedPost);
      await user.save();

      res.json({ _id: savedPost._id.toString() });
    }
  }),
];

exports.post_put = [
  passport.authenticate('jwt', { session: false }),
  param('postid', 'Post id must be valid').trim().custom(isDbIdValid).escape(),
  body('title', 'Title must have correct length')
    .optional()
    .trim()
    .isLength({ min: 3, max: 100 }),
  body('body', 'Post body must have correct length')
    .optional()
    .trim()
    .isLength({ min: 100, max: 10000 }),
  body('topic', 'Topic must be valid')
    .optional()
    .trim()
    .customSanitizer(topicSanitizer)
    .escape(),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      res.status(400).json({ message: 'Validation error', errors: errors.array() });
    } else {
      const postById = await Post.findById(req.params.postid).exec();

      if (!postById) {
        res.status(404).json({ message: 'Post not found' });
      } else {
        if (!postById.author._id.equals(req.user._id)) {
          res.status(403).json({ message: 'Authorization error' });
        } else {
          const postDetail = {
            title: req.body.title,
            body: req.body.body,
            topic: req.body.topic,
          };

          const updatedPost = await Post.findByIdAndUpdate(
            req.params.postid,
            postDetail,
            { new: true, runValidators: true }
          )
            .select('author title body date topic like_count thumbnail_image')
            .populate('author', 'username profile_image')
            .populate('topic', 'name')
            .exec();

          res.json(updatedPost);
        }
      }
    }
  }),
];

exports.post_delete = [
  passport.authenticate('jwt', { session: false }),
  param('postid', 'Post id must be valid').trim().custom(isDbIdValid).escape(),
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      res.status(400).json({ message: 'Validation error', errors: errors.array() });
    } else {
      const postById = await Post.findById(req.params.postid).exec();

      if (!postById) {
        res.status(404).json({ message: 'Post not found' });
      } else {
        if (!postById.author._id.equals(req.user._id)) {
          res.status(403).json({ message: 'Authorization error' });
        } else {
          await postById.deleteOne();

          res.json({ _id: postById._id.toString() });
        }
      }
    }
  }),
];
