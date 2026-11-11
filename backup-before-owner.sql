--
-- PostgreSQL database dump
--

\restrict Qc2YH1TVhjR7idhTbY0zvc3mPaucZQ8VkDiDtd7KOEqkEmH4I9RMltKkR0Sg9GL

-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: attachments_status_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.attachments_status_enum AS ENUM (
    'pending',
    'attached'
);


ALTER TYPE public.attachments_status_enum OWNER TO postgres;

--
-- Name: chats_type_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.chats_type_enum AS ENUM (
    'private',
    'groupe',
    'channel'
);


ALTER TYPE public.chats_type_enum OWNER TO postgres;

--
-- Name: users_status_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.users_status_enum AS ENUM (
    'active',
    'deleted',
    'baned'
);


ALTER TYPE public.users_status_enum OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: attachments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.attachments (
    id bigint NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "originalName" character varying(255) NOT NULL,
    "storageKey" character varying(255) NOT NULL,
    "mimeType" character varying(100) NOT NULL,
    size bigint NOT NULL,
    status public.attachments_status_enum DEFAULT 'pending'::public.attachments_status_enum NOT NULL,
    "uploaderId" bigint,
    "chatId" bigint,
    "messageId" bigint,
    width integer,
    height integer,
    duration numeric(10,1),
    "posterPath" character varying(255),
    voice boolean,
    waveform smallint[]
);


ALTER TABLE public.attachments OWNER TO postgres;

--
-- Name: attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.attachments_id_seq OWNER TO postgres;

--
-- Name: attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.attachments_id_seq OWNED BY public.attachments.id;


--
-- Name: chat_members; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chat_members (
    id bigint NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "chatId" bigint,
    "userId" bigint,
    "roleId" bigint
);


ALTER TABLE public.chat_members OWNER TO postgres;

--
-- Name: chat_members_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.chat_members_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.chat_members_id_seq OWNER TO postgres;

--
-- Name: chat_members_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.chat_members_id_seq OWNED BY public.chat_members.id;


--
-- Name: chat_seen; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chat_seen (
    id bigint NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "userId" bigint,
    "chatId" bigint,
    "messageId" bigint
);


ALTER TABLE public.chat_seen OWNER TO postgres;

--
-- Name: chat_seen_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.chat_seen_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.chat_seen_id_seq OWNER TO postgres;

--
-- Name: chat_seen_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.chat_seen_id_seq OWNED BY public.chat_seen.id;


--
-- Name: chats; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chats (
    id bigint NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    title character varying,
    avatars text[] DEFAULT '{}'::text[] NOT NULL,
    type public.chats_type_enum NOT NULL,
    "isBan" boolean DEFAULT false NOT NULL,
    "pairKey" character varying(40)
);


ALTER TABLE public.chats OWNER TO postgres;

--
-- Name: chats_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.chats_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.chats_id_seq OWNER TO postgres;

--
-- Name: chats_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.chats_id_seq OWNED BY public.chats.id;


--
-- Name: link; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.link (
    id bigint NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    code character varying(20) NOT NULL,
    "usageLimit" integer DEFAULT 0 NOT NULL,
    "usageCount" integer DEFAULT 0 NOT NULL,
    "expiresAt" timestamp without time zone,
    "isActive" boolean DEFAULT true NOT NULL,
    "chatId" bigint
);


ALTER TABLE public.link OWNER TO postgres;

--
-- Name: link_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.link_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.link_id_seq OWNER TO postgres;

--
-- Name: link_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.link_id_seq OWNED BY public.link.id;


--
-- Name: message_react; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.message_react (
    id bigint NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "userId" bigint,
    "messageId" bigint,
    "reactId" bigint
);


ALTER TABLE public.message_react OWNER TO postgres;

--
-- Name: message_react_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.message_react_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.message_react_id_seq OWNER TO postgres;

--
-- Name: message_react_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.message_react_id_seq OWNED BY public.message_react.id;


--
-- Name: messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.messages (
    id bigint NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    content text,
    "isEdited" boolean DEFAULT false NOT NULL,
    "isDeleted" boolean DEFAULT false NOT NULL,
    "typeId" bigint,
    "senderId" bigint,
    "chatId" bigint,
    "replyToId" bigint,
    "forwardedFromUserId" bigint,
    "forwardedFromName" character varying(100)
);


ALTER TABLE public.messages OWNER TO postgres;

--
-- Name: messages_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.messages_id_seq OWNER TO postgres;

--
-- Name: messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.messages_id_seq OWNED BY public.messages.id;


--
-- Name: permission_admin; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.permission_admin (
    id bigint NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "permissionId" bigint,
    "memberId" bigint
);


ALTER TABLE public.permission_admin OWNER TO postgres;

--
-- Name: permission_admin_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.permission_admin_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.permission_admin_id_seq OWNER TO postgres;

--
-- Name: permission_admin_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.permission_admin_id_seq OWNED BY public.permission_admin.id;


--
-- Name: permission_chats; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.permission_chats (
    id bigint NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    name character varying NOT NULL
);


ALTER TABLE public.permission_chats OWNER TO postgres;

--
-- Name: permission_chats_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.permission_chats_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.permission_chats_id_seq OWNER TO postgres;

--
-- Name: permission_chats_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.permission_chats_id_seq OWNED BY public.permission_chats.id;


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.permissions (
    id bigint NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    name character varying NOT NULL
);


ALTER TABLE public.permissions OWNER TO postgres;

--
-- Name: permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.permissions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.permissions_id_seq OWNER TO postgres;

--
-- Name: permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.permissions_id_seq OWNED BY public.permissions.id;


--
-- Name: reacts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reacts (
    id bigint NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    name character varying NOT NULL,
    emoji character varying NOT NULL
);


ALTER TABLE public.reacts OWNER TO postgres;

--
-- Name: reacts_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.reacts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.reacts_id_seq OWNER TO postgres;

--
-- Name: reacts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.reacts_id_seq OWNED BY public.reacts.id;


--
-- Name: role_chat; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.role_chat (
    id bigint NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    name character varying NOT NULL
);


ALTER TABLE public.role_chat OWNER TO postgres;

--
-- Name: role_chat_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.role_chat_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.role_chat_id_seq OWNER TO postgres;

--
-- Name: role_chat_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.role_chat_id_seq OWNED BY public.role_chat.id;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.roles (
    id bigint NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    name character varying NOT NULL
);


ALTER TABLE public.roles OWNER TO postgres;

--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.roles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.roles_id_seq OWNER TO postgres;

--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: type_messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.type_messages (
    id bigint NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    name character varying NOT NULL
);


ALTER TABLE public.type_messages OWNER TO postgres;

--
-- Name: type_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.type_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.type_messages_id_seq OWNER TO postgres;

--
-- Name: type_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.type_messages_id_seq OWNED BY public.type_messages.id;


--
-- Name: user_permissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_permissions (
    id bigint NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "userId" bigint,
    "permissionId" bigint
);


ALTER TABLE public.user_permissions OWNER TO postgres;

--
-- Name: user_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.user_permissions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_permissions_id_seq OWNER TO postgres;

--
-- Name: user_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.user_permissions_id_seq OWNED BY public.user_permissions.id;


--
-- Name: user_profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_profiles (
    id bigint NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    name character varying,
    username character varying(30),
    biografy character varying,
    avatars text[] DEFAULT '{}'::text[] NOT NULL,
    "userId" bigint
);


ALTER TABLE public.user_profiles OWNER TO postgres;

--
-- Name: user_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.user_profiles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_profiles_id_seq OWNER TO postgres;

--
-- Name: user_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.user_profiles_id_seq OWNED BY public.user_profiles.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    phone character varying NOT NULL,
    "isOnline" boolean DEFAULT false NOT NULL,
    "lastSeen" timestamp without time zone,
    status public.users_status_enum DEFAULT 'active'::public.users_status_enum NOT NULL,
    "refreshToken" character varying,
    "roleId" bigint
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: attachments id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attachments ALTER COLUMN id SET DEFAULT nextval('public.attachments_id_seq'::regclass);


--
-- Name: chat_members id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_members ALTER COLUMN id SET DEFAULT nextval('public.chat_members_id_seq'::regclass);


--
-- Name: chat_seen id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_seen ALTER COLUMN id SET DEFAULT nextval('public.chat_seen_id_seq'::regclass);


--
-- Name: chats id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chats ALTER COLUMN id SET DEFAULT nextval('public.chats_id_seq'::regclass);


--
-- Name: link id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.link ALTER COLUMN id SET DEFAULT nextval('public.link_id_seq'::regclass);


--
-- Name: message_react id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.message_react ALTER COLUMN id SET DEFAULT nextval('public.message_react_id_seq'::regclass);


--
-- Name: messages id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages ALTER COLUMN id SET DEFAULT nextval('public.messages_id_seq'::regclass);


--
-- Name: permission_admin id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission_admin ALTER COLUMN id SET DEFAULT nextval('public.permission_admin_id_seq'::regclass);


--
-- Name: permission_chats id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission_chats ALTER COLUMN id SET DEFAULT nextval('public.permission_chats_id_seq'::regclass);


--
-- Name: permissions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permissions ALTER COLUMN id SET DEFAULT nextval('public.permissions_id_seq'::regclass);


--
-- Name: reacts id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reacts ALTER COLUMN id SET DEFAULT nextval('public.reacts_id_seq'::regclass);


--
-- Name: role_chat id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_chat ALTER COLUMN id SET DEFAULT nextval('public.role_chat_id_seq'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: type_messages id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.type_messages ALTER COLUMN id SET DEFAULT nextval('public.type_messages_id_seq'::regclass);


--
-- Name: user_permissions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_permissions ALTER COLUMN id SET DEFAULT nextval('public.user_permissions_id_seq'::regclass);


--
-- Name: user_profiles id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_profiles ALTER COLUMN id SET DEFAULT nextval('public.user_profiles_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Data for Name: attachments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.attachments (id, "createdAt", "updatedAt", "originalName", "storageKey", "mimeType", size, status, "uploaderId", "chatId", "messageId", width, height, duration, "posterPath", voice, waveform) FROM stdin;
1	2026-11-08 17:18:24.914647	2026-11-08 17:18:24.914647	real.jpg	1/64c7ebb4-2217-4000-ba80-ce8cd8b4c207.jpg	image/jpeg	2069	pending	2	1	\N	\N	\N	\N	\N	\N	\N
2	2026-11-08 17:18:24.914647	2026-11-08 17:18:24.914647	test.pdf	1/bd3bfa68-d18b-4a5a-ab2a-c83d4218a8b7.pdf	application/pdf	45	pending	2	1	\N	\N	\N	\N	\N	\N	\N
3	2026-11-08 17:21:30.295396	2026-11-08 17:21:30.295396	mid.pdf	1/ad557a08-41e0-4099-b8f9-2b67e4be3b70.pdf	application/pdf	12582912	pending	2	1	\N	\N	\N	\N	\N	\N	\N
4	2026-11-08 17:22:10.64226	2026-11-08 17:22:10.64226	photo.png	1/bc9e21aa-3482-4b0b-ab9e-786473d5d699.png	image/png	635	pending	2	1	\N	\N	\N	\N	\N	\N	\N
5	2026-11-08 17:22:10.674832	2026-11-08 17:22:10.712994	photo.png	1/804fe209-875d-4701-885e-e2e1ba686ed4.png	image/png	635	attached	2	1	148	\N	\N	\N	\N	\N	\N
6	2026-11-08 17:22:10.674832	2026-11-08 17:22:10.712994	گزارش-آزمایش.pdf	1/eb3d30e0-da25-4d14-874b-e77508667ee3.pdf	application/pdf	45	attached	2	1	148	\N	\N	\N	\N	\N	\N
7	2026-11-08 17:22:11.209507	2026-11-08 17:22:11.209507	گزارش-آزمایش.pdf	1/8890e4b4-52cf-456d-92c5-db7d29a87e9a.pdf	application/pdf	45	pending	2	1	\N	\N	\N	\N	\N	\N	\N
8	2026-11-08 17:23:06.678427	2026-11-08 17:23:06.865598	probe.png	1/90b82fd9-58cd-4e63-b4f6-5b70477a8e35.png	image/png	98	attached	2	1	149	\N	\N	\N	\N	\N	\N
9	2026-11-08 17:23:06.709493	2026-11-08 17:23:06.865598	probe.pdf	1/dacb0c1b-3b6d-4516-80bc-f9328ce815c0.pdf	application/pdf	15	attached	2	1	149	\N	\N	\N	\N	\N	\N
10	2026-11-08 17:24:22.666639	2026-11-08 17:24:22.666639	photo.png	1/cdeeece0-6330-4d45-8207-8aaa54eef9f3.png	image/png	635	pending	2	1	\N	\N	\N	\N	\N	\N	\N
11	2026-11-08 17:24:22.71992	2026-11-08 17:24:22.75535	photo.png	1/4af54bbe-5585-4155-b1a3-d10fdbc8faf1.png	image/png	635	attached	2	1	150	\N	\N	\N	\N	\N	\N
12	2026-11-08 17:24:22.71992	2026-11-08 17:24:22.75535	گزارش-آزمایش.pdf	1/65cabb3d-1bc5-4b03-818f-2281f488a647.pdf	application/pdf	45	attached	2	1	150	\N	\N	\N	\N	\N	\N
13	2026-11-08 17:24:23.204645	2026-11-08 17:24:23.204645	گزارش-آزمایش.pdf	1/1274c694-1afa-4f6c-a345-42dfe4d8fe47.pdf	application/pdf	45	pending	2	1	\N	\N	\N	\N	\N	\N	\N
14	2026-11-08 17:25:58.047597	2026-11-08 17:25:58.047597	photo.png	1/c14e34ad-f864-4b90-805c-fbec3ac3ed01.png	image/png	635	pending	2	1	\N	\N	\N	\N	\N	\N	\N
15	2026-11-08 17:25:58.080929	2026-11-08 17:25:58.118272	photo.png	1/3135aebf-fbae-419a-a83d-6915fdd05612.png	image/png	635	attached	2	1	151	\N	\N	\N	\N	\N	\N
16	2026-11-08 17:25:58.080929	2026-11-08 17:25:58.118272	گزارش-آزمایش.pdf	1/634f0261-5df1-4dcd-a727-67c0bdb10217.pdf	application/pdf	45	attached	2	1	151	\N	\N	\N	\N	\N	\N
17	2026-11-08 17:25:58.549875	2026-11-08 17:25:58.549875	گزارش-آزمایش.pdf	1/fb317d14-7112-461a-bf13-de2156103221.pdf	application/pdf	45	pending	2	1	\N	\N	\N	\N	\N	\N	\N
18	2026-11-08 17:25:58.622531	2026-11-08 17:25:58.646214	photo.png	1/81722f50-af04-479b-b714-2a6fca7bbb2e.png	image/png	635	attached	2	1	152	\N	\N	\N	\N	\N	\N
19	2026-11-08 17:31:29.405211	2026-11-08 17:31:29.597538	1000214816.jpg	1/8839997b-217e-49a7-835b-56b0702a7a44.jpg	image/jpeg	61149	attached	2	1	154	\N	\N	\N	\N	\N	\N
20	2026-11-08 17:32:22.106639	2026-11-08 17:32:23.969648	1000214082.jpg	1/02b38363-18c0-4913-8b1d-3fc7b73dda4f.jpg	image/jpeg	153795	attached	2	1	155	\N	\N	\N	\N	\N	\N
21	2026-11-08 17:32:23.865765	2026-11-08 17:32:23.969648	1000214452.jpg	1/c1bf9d55-2695-4b0a-8f1a-9de5bd84ae4b.jpg	image/jpeg	1535305	attached	2	1	155	\N	\N	\N	\N	\N	\N
22	2026-11-08 21:44:55.326423	2026-11-08 21:44:55.387356	mrhdudhh-1o2_%DA%A9%D9%BE%DB%8C.pdf	1/adfc5875-ae26-494e-b5ed-94d0262e8b37.pdf	application/pdf	14453	attached	2	1	156	\N	\N	\N	\N	\N	\N
23	2026-11-08 21:48:49.944316	2026-11-08 21:48:49.944316	photo.png	1/08d99be5-f959-47b8-8c7f-8b8282f69dca.png	image/png	635	pending	2	1	\N	\N	\N	\N	\N	\N	\N
24	2026-11-08 21:48:49.977157	2026-11-08 21:48:50.004104	photo.png	1/5866e9b9-9bcb-4517-9032-a575bcfd6c57.png	image/png	635	attached	2	1	158	\N	\N	\N	\N	\N	\N
25	2026-11-08 21:48:49.977157	2026-11-08 21:48:50.004104	گزارش-آزمایش.pdf	1/c59e802d-0b97-4b3a-a527-4417f5b0c20e.pdf	application/pdf	45	attached	2	1	158	\N	\N	\N	\N	\N	\N
26	2026-11-08 21:48:50.388239	2026-11-08 21:48:50.388239	گزارش-آزمایش.pdf	1/4ec31749-5bc3-45ef-acbe-ef6fc064f687.pdf	application/pdf	45	pending	2	1	\N	\N	\N	\N	\N	\N	\N
27	2026-11-08 21:48:50.444691	2026-11-08 21:48:50.470041	photo.png	1/bd7d4529-2e2a-4511-8cfa-a8b88f62f6f7.png	image/png	635	attached	2	1	159	\N	\N	\N	\N	\N	\N
29	2026-11-08 22:06:32.613603	2026-11-08 22:06:32.613603	clip.m4a	1/35fd865a-4c0e-457a-ade0-9aa29046a2b1.m4a	audio/mp4	18786	pending	2	1	\N	\N	\N	\N	\N	\N	\N
28	2026-11-08 22:06:32.564291	2026-11-08 22:06:32.91219	clip.mp4	1/8535206b-a76c-4bdf-b501-812ea57a1fd4.mp4	video/mp4	10882	attached	2	1	161	320	240	2.0	1/520ca908-a606-4ab2-8d2c-b9228ae316a6.poster.webp	\N	\N
30	2026-11-08 22:07:05.515697	2026-11-08 22:07:05.515697	photo.png	1/e3166634-8729-49ef-a225-5a8177ea0c76.png	image/png	635	pending	2	1	\N	160	120	\N	\N	\N	\N
31	2026-11-08 22:07:05.543094	2026-11-08 22:07:05.565559	photo.png	1/78e47227-3263-4a8e-a6fa-e9df61b4ca8f.png	image/png	635	attached	2	1	162	160	120	\N	\N	\N	\N
32	2026-11-08 22:07:05.543094	2026-11-08 22:07:05.565559	گزارش-آزمایش.pdf	1/7d1e83e0-f9f6-4bc3-b045-5c4deb53fc47.pdf	application/pdf	45	attached	2	1	162	\N	\N	\N	\N	\N	\N
33	2026-11-08 22:07:05.881193	2026-11-08 22:07:05.881193	گزارش-آزمایش.pdf	1/4225b10f-ef37-4377-aabc-4fc33732d8d0.pdf	application/pdf	45	pending	2	1	\N	\N	\N	\N	\N	\N	\N
34	2026-11-08 22:07:05.933716	2026-11-08 22:07:05.951736	photo.png	1/08357a07-759c-4cd4-bb3b-99e1eb881d06.png	image/png	635	attached	2	1	163	160	120	\N	\N	\N	\N
35	2026-11-08 22:14:12.880991	2026-11-08 22:14:12.979127	1000214063.mp4	1/31d3bb4f-bf2d-447c-9b04-6cefcf359644.mp4	video/mp4	13423222	attached	2	1	165	1080	1920	6.5	1/2e5b3b78-e325-4140-af0f-0f239161faa0.poster.webp	\N	\N
36	2026-11-08 22:27:48.934513	2026-11-08 22:27:49.018219	1000212604.mp4	1/36370e22-75c4-49d4-8430-368911b53940.mp4	video/mp4	1653117	attached	2	1	166	1080	1920	21.8	1/2c61dd23-b962-4051-abee-0b79f84f729f.poster.webp	\N	\N
37	2026-11-08 22:28:29.441894	2026-11-08 22:28:29.509447	1000208016.mp4	1/3d8265e7-f3c0-4ac7-acb7-3fcad6cd6991.mp4	video/mp4	3346577	attached	2	1	167	720	714	59.3	1/bebc36c0-7950-446d-beb4-3e5ded3b39f0.poster.webp	\N	\N
38	2026-11-08 22:29:42.21408	2026-11-08 22:29:42.307182	1000209616.mp4	1/5686134c-96b0-479d-95bd-19779d84ae26.mp4	video/mp4	90466761	attached	2	1	168	1080	1920	45.1	1/a1ae1f0c-176f-4eed-910e-2f421795257e.poster.webp	\N	\N
39	2026-11-09 12:17:41.275004	2026-11-09 12:17:41.370192	voice-1794226659312.m4a	1/26a2e5da-42ae-40a5-aeb6-01fe531de005.m4a	audio/mp4	19149	attached	2	1	169	\N	\N	2.6	\N	t	{0,0,2,2,2,3,3,3,3,4,22,10,21,19,23,26,87,96,93,75,69,81,100,87,95,95,92,84,61,68,44,37,55,89,86,61,35,78,91,91,80,75,73,69,58,42,34,31,22,12,11,11,11,12,13,12,13,12,12,8,10,6,8,8}
40	2026-11-09 12:18:02.358481	2026-11-09 12:18:02.460032	voice-1794226680202.m4a	1/af627ea5-5d96-49ce-a397-48ba5e86a86f.m4a	audio/mp4	59631	attached	2	1	170	\N	\N	9.3	\N	t	{2,3,5,4,6,7,9,61,64,69,67,69,67,65,63,71,67,42,7,52,64,59,52,56,56,50,39,9,8,12,15,13,10,9,9,10,14,18,19,11,11,11,10,10,7,7,7,8,34,34,79,95,100,95,86,88,66,6,8,7,8,8,7,7}
41	2026-11-09 13:33:45.798509	2026-11-09 13:33:45.798509	voice-1794226659312.m4a	3/22246bdb-60cd-4c2f-968a-c426857ae182.m4a	audio/mp4	19149	attached	2	3	171	\N	\N	2.6	\N	t	{0,0,2,2,2,3,3,3,3,4,22,10,21,19,23,26,87,96,93,75,69,81,100,87,95,95,92,84,61,68,44,37,55,89,86,61,35,78,91,91,80,75,73,69,58,42,34,31,22,12,11,11,11,12,13,12,13,12,12,8,10,6,8,8}
42	2026-11-09 13:34:24.893984	2026-11-09 13:34:24.9474	voice-1794231262767.m4a	3/1e13753f-31cb-4b81-98a4-206f70d3ddae.m4a	audio/mp4	29302	attached	2	3	172	\N	\N	4.3	\N	t	{0,15,21,71,90,73,92,65,95,81,96,90,68,54,92,96,90,89,72,59,96,69,66,83,39,80,100,89,92,57,59,79,91,94,79,53,54,43,45,42,31,35,46,48,48,43,43,47,47,48,52,46,55,92,45,55,53,52,50,45,47,68,66,74}
43	2026-11-09 16:01:19.812038	2026-11-09 16:01:20.030804	1000215087.jpg	3/b5e4cb6c-b199-40a1-8668-2dd6ba3b1052.jpg	image/jpeg	72532	attached	2	3	173	700	1280	\N	\N	\N	\N
44	2026-11-09 16:01:36.336067	2026-11-09 16:01:36.611003	1000215087.jpg	3/eb2057b3-9103-4c4e-8e80-a9058431ce96.jpg	image/jpeg	72532	attached	2	3	174	700	1280	\N	\N	\N	\N
45	2026-11-09 17:05:41.905383	2026-11-09 17:05:41.972879	voice-1794243941176.m4a	27/4a20279b-5755-4767-9eff-a413ba776785.m4a	audio/mp4	29926	attached	2	27	176	\N	\N	4.4	\N	t	{0,2,2,1,2,4,5,5,12,21,17,15,15,13,13,12,15,59,68,57,69,66,34,53,70,63,80,71,35,23,18,35,56,87,78,57,60,79,94,80,44,100,61,49,78,92,58,17,82,73,80,90,91,88,80,73,65,56,42,83,67,72,66,83}
46	2026-11-09 17:08:27.666048	2026-11-09 17:08:27.820896	1000003188.jpg	27/35c531be-2d5b-4aa6-b020-d797ba27f09e.jpg	image/jpeg	161480	attached	2	27	186	720	1280	\N	\N	\N	\N
\.


--
-- Data for Name: chat_members; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.chat_members (id, "createdAt", "updatedAt", "chatId", "userId", "roleId") FROM stdin;
1	2026-11-03 13:43:50.331415	2026-11-03 13:43:50.331415	1	2	2
2	2026-11-03 18:12:00.992395	2026-11-03 18:12:00.992395	2	4	2
3	2026-11-03 18:41:36.921591	2026-11-03 18:41:36.921591	3	2	2
4	2026-11-04 22:37:21.640136	2026-11-04 22:37:21.640136	4	5	2
5	2026-11-04 22:37:21.640136	2026-11-04 22:37:21.640136	4	6	3
6	2026-11-04 22:37:21.651919	2026-11-04 22:37:21.651919	5	5	2
7	2026-11-04 22:37:21.651919	2026-11-04 22:37:21.651919	5	6	3
8	2026-11-04 22:37:21.661988	2026-11-04 22:37:21.661988	6	6	2
9	2026-11-04 22:39:23.976194	2026-11-04 22:39:23.976194	7	5	2
10	2026-11-04 22:39:23.976194	2026-11-04 22:39:23.976194	7	6	3
11	2026-11-04 22:39:23.98888	2026-11-04 22:39:23.98888	8	5	2
12	2026-11-04 22:39:23.98888	2026-11-04 22:39:23.98888	8	6	3
13	2026-11-04 22:39:24.000552	2026-11-04 22:39:24.000552	9	6	2
14	2026-11-04 22:39:54.014359	2026-11-04 22:39:54.014359	10	5	2
15	2026-11-04 22:39:54.014359	2026-11-04 22:39:54.014359	10	6	3
16	2026-11-04 22:39:54.02785	2026-11-04 22:39:54.02785	11	5	2
17	2026-11-04 22:39:54.02785	2026-11-04 22:39:54.02785	11	6	3
18	2026-11-04 22:39:54.038073	2026-11-04 22:39:54.038073	12	6	2
19	2026-11-04 22:40:21.858358	2026-11-04 22:40:21.858358	13	5	2
20	2026-11-04 22:40:21.858358	2026-11-04 22:40:21.858358	13	6	3
21	2026-11-04 22:40:21.868909	2026-11-04 22:40:21.868909	14	5	2
22	2026-11-04 22:40:21.868909	2026-11-04 22:40:21.868909	14	6	3
23	2026-11-04 22:40:21.879055	2026-11-04 22:40:21.879055	15	6	2
24	2026-11-04 22:41:12.234306	2026-11-04 22:41:12.234306	16	5	2
25	2026-11-04 22:41:12.234306	2026-11-04 22:41:12.234306	16	6	3
26	2026-11-04 22:41:12.244307	2026-11-04 22:41:12.244307	17	5	2
27	2026-11-04 22:41:12.244307	2026-11-04 22:41:12.244307	17	6	3
28	2026-11-04 22:41:12.254529	2026-11-04 22:41:12.254529	18	6	2
29	2026-11-04 22:47:16.704397	2026-11-04 22:47:16.704397	19	5	2
30	2026-11-04 22:47:16.704397	2026-11-04 22:47:16.704397	19	6	3
31	2026-11-04 22:47:16.717035	2026-11-04 22:47:16.717035	20	5	2
32	2026-11-04 22:47:16.717035	2026-11-04 22:47:16.717035	20	6	3
33	2026-11-04 22:47:16.728353	2026-11-04 22:47:16.728353	21	6	2
34	2026-11-04 22:51:35.837931	2026-11-04 22:51:35.837931	22	5	2
35	2026-11-04 22:51:35.837931	2026-11-04 22:51:35.837931	22	6	3
36	2026-11-04 22:51:35.852057	2026-11-04 22:51:35.852057	23	5	2
37	2026-11-04 22:51:35.852057	2026-11-04 22:51:35.852057	23	6	3
38	2026-11-04 22:51:35.865415	2026-11-04 22:51:35.865415	24	6	2
39	2026-11-04 23:25:30.709047	2026-11-04 23:25:30.709047	3	5	2
40	2026-11-05 12:00:30.901647	2026-11-05 12:00:30.901647	25	5	2
41	2026-11-05 12:00:30.901647	2026-11-05 12:00:30.901647	25	6	3
42	2026-11-05 12:00:30.927277	2026-11-05 12:00:30.927277	26	5	2
43	2026-11-05 12:00:30.927277	2026-11-05 12:00:30.927277	26	6	3
44	2026-11-05 14:56:34.429405	2026-11-05 14:56:34.429405	1	3	3
45	2026-11-05 14:58:51.556087	2026-11-05 14:58:51.556087	1	3	3
46	2026-11-05 15:00:33.691326	2026-11-05 15:00:33.691326	1	9	3
47	2026-11-05 15:25:23.895203	2026-11-05 15:25:23.895203	3	\N	3
48	2026-11-05 15:26:24.271305	2026-11-05 15:26:24.271305	3	\N	3
49	2026-11-05 15:27:18.945825	2026-11-05 15:27:18.945825	3	\N	3
50	2026-11-05 15:27:31.432031	2026-11-05 15:27:31.432031	3	\N	3
51	2026-11-05 15:30:26.05474	2026-11-05 15:30:26.05474	3	9	3
52	2026-11-05 15:31:04.638703	2026-11-05 15:31:04.638703	27	9	2
53	2026-11-05 15:31:13.741201	2026-11-05 15:31:13.741201	27	2	3
54	2026-11-05 22:34:44.485227	2026-11-05 22:34:44.485227	28	5	2
55	2026-11-05 22:34:44.485227	2026-11-05 22:34:44.485227	28	6	3
56	2026-11-05 22:35:03.434236	2026-11-05 22:35:03.434236	29	5	2
57	2026-11-05 22:35:03.434236	2026-11-05 22:35:03.434236	29	6	3
58	2026-11-05 22:35:46.235438	2026-11-05 22:35:46.235438	30	5	2
59	2026-11-05 22:35:46.235438	2026-11-05 22:35:46.235438	30	6	3
60	2026-11-05 22:36:59.879492	2026-11-05 22:36:59.879492	31	5	2
61	2026-11-05 22:36:59.879492	2026-11-05 22:36:59.879492	31	6	3
62	2026-11-05 22:38:15.523498	2026-11-05 22:38:15.523498	32	5	2
63	2026-11-05 22:38:15.523498	2026-11-05 22:38:15.523498	32	6	3
64	2026-11-05 22:39:16.472698	2026-11-05 22:39:16.472698	33	10	2
65	2026-11-05 22:39:16.472698	2026-11-05 22:39:16.472698	33	7	3
66	2026-11-05 22:39:48.812582	2026-11-05 22:39:48.812582	34	5	2
67	2026-11-05 22:39:48.812582	2026-11-05 22:39:48.812582	34	6	3
68	2026-11-05 22:58:24.990788	2026-11-05 22:58:24.990788	35	5	2
69	2026-11-05 22:58:24.990788	2026-11-05 22:58:24.990788	35	6	3
70	2026-11-10 07:12:55.810096	2026-11-10 07:12:55.810096	36	2	3
71	2026-11-10 07:12:55.810096	2026-11-10 07:12:55.810096	36	9	3
\.


--
-- Data for Name: chat_seen; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.chat_seen (id, "createdAt", "updatedAt", "userId", "chatId", "messageId") FROM stdin;
24	2026-11-05 22:37:46.231789	2026-11-05 22:37:46.231789	5	31	123
25	2026-11-05 22:37:46.248705	2026-11-05 22:37:46.248705	6	31	123
20	2026-11-05 15:01:15.656502	2026-11-10 14:58:40.542249	9	1	184
4	2026-11-04 22:37:36.839951	2026-11-04 22:37:36.839951	6	4	13
3	2026-11-04 22:37:36.823145	2026-11-04 22:37:37.19007	5	4	14
6	2026-11-04 22:39:39.210461	2026-11-04 22:39:39.210461	6	7	17
5	2026-11-04 22:39:39.178037	2026-11-04 22:39:39.533276	5	7	18
8	2026-11-04 22:40:09.217762	2026-11-04 22:40:09.217762	6	10	20
7	2026-11-04 22:39:54.14648	2026-11-04 22:40:09.53018	5	10	21
9	2026-11-04 22:40:37.056696	2026-11-04 22:40:37.056696	6	13	23
10	2026-11-04 22:40:37.367807	2026-11-04 22:40:37.367807	5	13	24
11	2026-11-04 22:41:12.39173	2026-11-04 22:41:12.39173	6	16	26
12	2026-11-04 22:41:12.695774	2026-11-04 22:41:12.695774	5	16	27
13	2026-11-04 22:47:16.901142	2026-11-04 22:47:16.901142	6	19	29
14	2026-11-04 22:47:17.217982	2026-11-04 22:47:17.217982	5	19	30
15	2026-11-04 22:51:36.02505	2026-11-04 22:51:36.02505	6	22	32
16	2026-11-04 22:51:36.34451	2026-11-04 22:51:36.34451	5	22	33
17	2026-11-04 23:24:41.632895	2026-11-04 23:24:41.632895	5	23	48
18	2026-11-04 23:24:41.645699	2026-11-04 23:24:41.645699	6	23	48
19	2026-11-04 23:25:31.228659	2026-11-04 23:25:31.228659	5	3	44
21	2026-11-05 15:36:37.189039	2026-11-10 15:05:26.549967	2	27	212
22	2026-11-05 15:39:06.544908	2026-11-10 15:05:27.058215	9	27	212
26	2026-11-10 07:13:00.771277	2026-11-10 15:05:36.580719	2	36	213
27	2026-11-10 14:58:58.427413	2026-11-10 15:05:39.859297	9	36	213
1	2026-11-04 09:38:35.132677	2026-11-09 16:01:37.328422	2	3	174
2	2026-11-04 09:40:08.905666	2026-11-09 17:07:56.991629	2	1	184
23	2026-11-05 15:40:33.746052	2026-11-10 14:57:50.579407	9	3	174
\.


--
-- Data for Name: chats; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.chats (id, "createdAt", "updatedAt", title, avatars, type, "isBan", "pairKey") FROM stdin;
1	2026-11-03 13:43:50.313503	2026-11-03 13:43:50.313503	niazility	{}	groupe	f	\N
2	2026-11-03 18:12:00.955059	2026-11-03 18:12:00.955059	dgferg	{}	groupe	f	\N
3	2026-11-03 18:41:36.899345	2026-11-03 18:41:36.899345	niazfans	{}	groupe	f	\N
4	2026-11-04 22:37:21.632215	2026-11-04 22:37:21.632215	g-31841629	{}	groupe	f	\N
5	2026-11-04 22:37:21.647255	2026-11-04 22:37:21.647255	e-31841629	{}	groupe	f	\N
6	2026-11-04 22:37:21.657285	2026-11-04 22:37:21.657285	f-31841629	{}	groupe	f	\N
7	2026-11-04 22:39:23.967204	2026-11-04 22:39:23.967204	g-31963963	{}	groupe	f	\N
8	2026-11-04 22:39:23.983503	2026-11-04 22:39:23.983503	e-31963963	{}	groupe	f	\N
9	2026-11-04 22:39:23.995131	2026-11-04 22:39:23.995131	f-31963963	{}	groupe	f	\N
10	2026-11-04 22:39:54.007155	2026-11-04 22:39:54.007155	g-31994004	{}	groupe	f	\N
11	2026-11-04 22:39:54.022063	2026-11-04 22:39:54.022063	e-31994004	{}	groupe	f	\N
12	2026-11-04 22:39:54.033461	2026-11-04 22:39:54.033461	f-31994004	{}	groupe	f	\N
13	2026-11-04 22:40:21.852972	2026-11-04 22:40:21.852972	g-32021850	{}	groupe	f	\N
14	2026-11-04 22:40:21.864279	2026-11-04 22:40:21.864279	e-32021850	{}	groupe	f	\N
15	2026-11-04 22:40:21.874739	2026-11-04 22:40:21.874739	f-32021850	{}	groupe	f	\N
16	2026-11-04 22:41:12.228404	2026-11-04 22:41:12.228404	g-32072226	{}	groupe	f	\N
17	2026-11-04 22:41:12.240357	2026-11-04 22:41:12.240357	e-32072226	{}	groupe	f	\N
18	2026-11-04 22:41:12.249586	2026-11-04 22:41:12.249586	f-32072226	{}	groupe	f	\N
19	2026-11-04 22:47:16.695124	2026-11-04 22:47:16.695124	g-32436691	{}	groupe	f	\N
20	2026-11-04 22:47:16.71236	2026-11-04 22:47:16.71236	e-32436691	{}	groupe	f	\N
21	2026-11-04 22:47:16.723079	2026-11-04 22:47:16.723079	f-32436691	{}	groupe	f	\N
22	2026-11-04 22:51:35.829666	2026-11-04 22:51:35.829666	g-32695825	{}	groupe	f	\N
23	2026-11-04 22:51:35.845421	2026-11-04 22:51:35.845421	e-32695825	{}	groupe	f	\N
24	2026-11-04 22:51:35.859976	2026-11-04 22:51:35.859976	f-32695825	{}	groupe	f	\N
25	2026-11-05 12:00:30.8856	2026-11-05 12:00:30.8856	A-80030880	{}	groupe	f	\N
26	2026-11-05 12:00:30.918225	2026-11-05 12:00:30.918225	B-80030880	{}	groupe	f	\N
27	2026-11-05 15:31:04.629582	2026-11-05 15:31:04.629582	Love♥💋	{}	groupe	f	\N
28	2026-11-05 22:34:44.469631	2026-11-05 22:34:44.469631	ec-18084458	{}	groupe	f	\N
29	2026-11-05 22:35:03.427653	2026-11-05 22:35:03.427653	ec-18103424	{}	groupe	f	\N
30	2026-11-05 22:35:46.226342	2026-11-05 22:35:46.226342	ec-18146217	{}	groupe	f	\N
31	2026-11-05 22:36:59.870767	2026-11-05 22:36:59.870767	ec-18219862	{}	groupe	f	\N
32	2026-11-05 22:38:15.516041	2026-11-05 22:38:15.516041	probe1793918295513	{}	groupe	f	\N
33	2026-11-05 22:39:16.466702	2026-11-05 22:39:16.466702	probe1793918356464	{}	groupe	f	\N
34	2026-11-05 22:39:48.803617	2026-11-05 22:39:48.803617	ec-18388794	{}	groupe	f	\N
35	2026-11-05 22:58:24.971013	2026-11-05 22:58:24.971013	ec-19504955	{}	groupe	f	\N
36	2026-11-10 07:12:55.810096	2026-11-10 07:12:55.810096	\N	{}	private	f	2:9
\.


--
-- Data for Name: link; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.link (id, "createdAt", "updatedAt", code, "usageLimit", "usageCount", "expiresAt", "isActive", "chatId") FROM stdin;
\.


--
-- Data for Name: message_react; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.message_react (id, "createdAt", "updatedAt", "userId", "messageId", "reactId") FROM stdin;
37	2026-11-10 07:57:04.22302	2026-11-10 07:57:04.22302	2	193	3
39	2026-11-10 07:57:43.539694	2026-11-10 07:57:43.539694	2	196	6
40	2026-11-10 14:58:21.524679	2026-11-10 14:58:21.524679	9	199	6
42	2026-11-10 15:04:49.390854	2026-11-10 15:05:01.474701	2	210	6
\.


--
-- Data for Name: messages; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.messages (id, "createdAt", "updatedAt", content, "isEdited", "isDeleted", "typeId", "senderId", "chatId", "replyToId", "forwardedFromUserId", "forwardedFromName") FROM stdin;
1	2026-11-04 09:28:41.112337	2026-11-04 09:28:41.112337	hi	f	f	4	2	3	\N	\N	\N
2	2026-11-04 09:29:46.042603	2026-11-04 09:29:46.042603	d	f	f	4	2	3	\N	\N	\N
3	2026-11-04 09:38:48.537316	2026-11-04 09:38:48.537316	ht	f	f	4	2	3	\N	\N	\N
4	2026-11-04 09:39:16.890704	2026-11-04 09:39:16.890704	gg	f	f	4	2	1	\N	\N	\N
5	2026-11-04 09:40:18.319122	2026-11-04 09:40:18.319122	ddv	f	f	4	2	1	\N	\N	\N
6	2026-11-04 09:41:05.433358	2026-11-04 09:41:05.433358	f	f	f	4	2	1	\N	\N	\N
7	2026-11-04 09:42:11.279761	2026-11-04 09:42:11.279761	f	f	f	4	2	1	\N	\N	\N
8	2026-11-04 09:43:28.069082	2026-11-04 09:43:28.069082	b	f	f	4	2	1	\N	\N	\N
9	2026-11-04 09:44:45.023912	2026-11-04 09:44:45.023912	xj	f	f	4	2	1	\N	\N	\N
10	2026-11-04 09:54:48.1866	2026-11-04 09:54:48.1866	d	f	f	4	2	3	\N	\N	\N
11	2026-11-04 09:55:47.620647	2026-11-04 09:55:47.620647	h	f	f	4	2	1	\N	\N	\N
12	2026-11-04 09:59:04.091826	2026-11-04 09:59:04.091826	c	f	f	4	2	1	\N	\N	\N
13	2026-11-04 22:37:21.75782	2026-11-04 22:37:21.75782	integration 1793831841745	f	f	4	5	4	\N	\N	\N
30	2026-11-04 22:47:16.914947	2026-11-04 22:47:16.991548	edited 1793832436943	t	t	4	5	19	\N	\N	\N
14	2026-11-04 22:37:36.852619	2026-11-04 22:37:36.950185	edited 1793831856881	t	t	4	5	4	\N	\N	\N
15	2026-11-04 22:37:37.207115	2026-11-04 22:37:37.207115	reconnected 1793831857196	f	f	4	5	4	\N	\N	\N
16	2026-11-04 22:38:37.03641	2026-11-04 22:38:37.03641	debug 1793831917024	f	f	4	5	5	\N	\N	\N
17	2026-11-04 22:39:24.109639	2026-11-04 22:39:24.109639	integration 1793831964098	f	f	4	5	7	\N	\N	\N
31	2026-11-04 22:47:17.229839	2026-11-04 22:47:17.229839	reconnected 1793832437222	f	f	4	5	19	\N	\N	\N
18	2026-11-04 22:39:39.227066	2026-11-04 22:39:39.306992	edited 1793831979259	t	t	4	5	7	\N	\N	\N
19	2026-11-04 22:39:39.544527	2026-11-04 22:39:39.544527	reconnected 1793831979537	f	f	4	5	7	\N	\N	\N
20	2026-11-04 22:39:54.123162	2026-11-04 22:39:54.123162	integration 1793831994113	f	f	4	5	10	\N	\N	\N
32	2026-11-04 22:51:35.97431	2026-11-04 22:51:35.97431	integration 1793832695963	f	f	4	5	22	\N	\N	\N
21	2026-11-04 22:40:09.231778	2026-11-04 22:40:09.303849	edited 1793832009259	t	t	4	5	10	\N	\N	\N
22	2026-11-04 22:40:09.541989	2026-11-04 22:40:09.541989	reconnected 1793832009534	f	f	4	5	10	\N	\N	\N
23	2026-11-04 22:40:21.975899	2026-11-04 22:40:21.975899	integration 1793832021963	f	f	4	5	13	\N	\N	\N
49	2026-11-04 23:24:41.659055	2026-11-04 23:24:41.659055	probe-history	f	f	4	6	23	\N	\N	\N
24	2026-11-04 22:40:37.075482	2026-11-04 22:40:37.144807	edited 1793832037103	t	t	4	5	13	\N	\N	\N
25	2026-11-04 22:40:37.38217	2026-11-04 22:40:37.38217	reconnected 1793832037372	f	f	4	5	13	\N	\N	\N
26	2026-11-04 22:41:12.348076	2026-11-04 22:41:12.348076	integration 1793832072338	f	f	4	5	16	\N	\N	\N
33	2026-11-04 22:51:36.038415	2026-11-04 22:51:36.114399	edited 1793832696072	t	t	4	5	22	\N	\N	\N
27	2026-11-04 22:41:12.403819	2026-11-04 22:41:12.472548	edited 1793832072430	t	t	4	5	16	\N	\N	\N
28	2026-11-04 22:41:12.707087	2026-11-04 22:41:12.707087	reconnected 1793832072700	f	f	4	5	16	\N	\N	\N
29	2026-11-04 22:47:16.847163	2026-11-04 22:47:16.847163	integration 1793832436834	f	f	4	5	19	\N	\N	\N
50	2026-11-04 23:24:41.696988	2026-11-04 23:24:41.696988	probe-echo-u1	f	f	4	5	23	\N	\N	\N
34	2026-11-04 22:51:36.355929	2026-11-04 22:51:36.355929	reconnected 1793832696348	f	f	4	5	22	\N	\N	\N
35	2026-11-04 23:00:01.033713	2026-11-04 23:00:01.033713	ت	f	f	4	2	3	\N	\N	\N
36	2026-11-04 23:00:20.168359	2026-11-04 23:00:20.168359	ت	f	f	4	2	1	\N	\N	\N
37	2026-11-04 23:01:23.261027	2026-11-04 23:01:23.261027	amirniaz	f	f	4	2	3	\N	\N	\N
38	2026-11-04 23:02:52.542084	2026-11-04 23:02:52.542084	air	f	f	4	2	3	\N	\N	\N
39	2026-11-04 23:03:34.936412	2026-11-04 23:03:34.936412	vv	f	f	4	2	3	\N	\N	\N
40	2026-11-04 23:03:43.742709	2026-11-04 23:03:43.742709	bh	f	f	4	2	3	\N	\N	\N
41	2026-11-04 23:07:05.785936	2026-11-04 23:07:05.785936	ccc	f	f	4	2	3	\N	\N	\N
42	2026-11-04 23:15:26.581498	2026-11-04 23:15:26.581498	c	f	f	4	2	1	\N	\N	\N
43	2026-11-04 23:16:45.299214	2026-11-04 23:16:45.299214	xx	f	f	4	2	1	\N	\N	\N
44	2026-11-04 23:18:35.745143	2026-11-04 23:18:35.745143	h	f	f	4	2	3	\N	\N	\N
45	2026-11-04 23:22:33.030867	2026-11-04 23:22:33.030867	jj	f	f	4	2	1	\N	\N	\N
46	2026-11-04 23:23:04.224944	2026-11-04 23:23:04.224944	probe-history	f	f	4	6	23	\N	\N	\N
47	2026-11-04 23:23:04.260845	2026-11-04 23:23:04.260845	probe-echo-u1	f	f	4	5	23	\N	\N	\N
48	2026-11-04 23:23:04.282584	2026-11-04 23:23:04.310387	probe-edited-u2	t	f	4	6	23	\N	\N	\N
59	2026-11-05 11:14:29.198245	2026-11-05 11:14:29.198245	ب	f	f	4	2	3	\N	\N	\N
51	2026-11-04 23:24:41.719351	2026-11-04 23:24:41.742906	probe-edited-u2	t	f	4	6	23	\N	\N	\N
52	2026-11-04 23:25:31.245718	2026-11-04 23:25:31.245718	probe-history	f	f	4	5	3	\N	\N	\N
54	2026-11-04 23:25:31.311249	2026-11-04 23:25:31.343477	probe-edited-u2	t	f	4	5	3	\N	\N	\N
56	2026-11-04 23:39:35.693047	2026-11-04 23:39:35.693047	ذت	f	f	4	2	1	\N	\N	\N
57	2026-11-05 11:13:41.564246	2026-11-05 11:13:41.564246	ر	f	f	4	2	3	\N	\N	\N
58	2026-11-05 11:13:56.081171	2026-11-05 11:13:56.081171	ی	f	f	4	2	1	\N	\N	\N
60	2026-11-05 11:14:40.156008	2026-11-05 11:14:40.156008	j	f	f	4	2	1	\N	\N	\N
61	2026-11-05 11:15:43.149229	2026-11-05 11:15:43.149229	b	f	f	4	2	1	\N	\N	\N
62	2026-11-05 11:15:56.036271	2026-11-05 11:15:56.036271	bn	f	f	4	2	3	\N	\N	\N
63	2026-11-05 11:16:47.034873	2026-11-05 11:16:47.034873	fhf	f	f	4	2	1	\N	\N	\N
64	2026-11-05 11:16:53.463833	2026-11-05 11:16:53.463833	fbhgx	f	f	4	2	3	\N	\N	\N
65	2026-11-05 11:17:10.574275	2026-11-05 11:17:10.574275	jffjcj	f	f	4	2	1	\N	\N	\N
66	2026-11-05 11:17:57.478317	2026-11-05 11:17:57.478317	fbc	f	f	4	2	1	\N	\N	\N
67	2026-11-05 11:18:00.653021	2026-11-05 11:18:00.653021	vfs	f	f	4	2	1	\N	\N	\N
68	2026-11-05 11:18:04.233737	2026-11-05 11:18:04.233737	sg.	f	f	4	2	1	\N	\N	\N
69	2026-11-05 11:18:07.720748	2026-11-05 11:18:07.720748	sgdsg	f	f	4	2	1	\N	\N	\N
70	2026-11-05 11:18:15.202727	2026-11-05 11:18:15.202727	fd	f	f	4	2	3	\N	\N	\N
71	2026-11-05 11:27:51.307084	2026-11-05 11:27:51.307084	x	f	f	4	2	1	\N	\N	\N
72	2026-11-05 11:28:51.413602	2026-11-05 11:28:51.413602	fhf	f	f	4	2	3	\N	\N	\N
73	2026-11-05 11:29:13.041755	2026-11-05 11:29:13.041755	jv	f	f	4	2	3	\N	\N	\N
74	2026-11-05 11:29:57.467956	2026-11-05 11:29:57.467956	bhj	f	f	4	2	3	\N	\N	\N
75	2026-11-05 11:32:05.160859	2026-11-05 11:32:05.160859	vbdn	f	f	4	2	3	\N	\N	\N
76	2026-11-05 11:32:31.573437	2026-11-05 11:32:31.573437	v	f	f	4	2	1	\N	\N	\N
77	2026-11-05 11:32:44.810905	2026-11-05 11:32:44.810905	bb	f	f	4	2	1	\N	\N	\N
78	2026-11-05 11:32:53.484978	2026-11-05 11:32:53.484978	bn n	f	f	4	2	3	\N	\N	\N
53	2026-11-04 23:25:31.28781	2026-11-05 23:09:11.22279	probe-echo-u1	f	t	4	2	3	\N	\N	\N
79	2026-11-05 11:33:04.464624	2026-11-05 11:33:04.464624	gjj	f	f	4	2	3	\N	\N	\N
80	2026-11-05 11:33:07.327428	2026-11-05 11:33:07.327428	vj	f	f	4	2	3	\N	\N	\N
81	2026-11-05 11:33:12.431052	2026-11-05 11:33:12.431052	hu	f	f	4	2	1	\N	\N	\N
82	2026-11-05 11:34:51.458439	2026-11-05 11:34:51.458439	n	f	f	4	2	1	\N	\N	\N
83	2026-11-05 11:34:55.540581	2026-11-05 11:34:55.540581	bj	f	f	4	2	3	\N	\N	\N
84	2026-11-05 11:35:00.263468	2026-11-05 11:35:00.263468	nkg	f	f	4	2	1	\N	\N	\N
85	2026-11-05 11:35:06.201396	2026-11-05 11:35:06.201396	jnc	f	f	4	2	3	\N	\N	\N
86	2026-11-05 11:37:41.952073	2026-11-05 11:37:41.952073	xn n	f	f	4	2	1	\N	\N	\N
87	2026-11-05 11:39:10.329367	2026-11-05 11:39:10.329367	bhg	f	f	4	2	3	\N	\N	\N
88	2026-11-05 11:40:05.634663	2026-11-05 11:40:05.634663	g	f	f	4	2	3	\N	\N	\N
89	2026-11-05 11:40:16.55105	2026-11-05 11:40:16.55105	gg	f	f	4	2	3	\N	\N	\N
90	2026-11-05 11:44:35.940379	2026-11-05 11:44:35.940379	vh	f	f	4	2	3	\N	\N	\N
91	2026-11-05 11:44:45.677281	2026-11-05 11:44:45.677281	vjf	f	f	4	2	3	\N	\N	\N
92	2026-11-05 11:44:53.144886	2026-11-05 11:44:53.144886	cg	f	f	4	2	3	\N	\N	\N
93	2026-11-05 11:45:01.44866	2026-11-05 11:45:01.44866	aq	f	f	4	2	1	\N	\N	\N
94	2026-11-05 11:45:05.339353	2026-11-05 11:45:05.339353	bh	f	f	4	2	1	\N	\N	\N
95	2026-11-05 11:45:09.945682	2026-11-05 11:45:09.945682	bjf	f	f	4	2	3	\N	\N	\N
96	2026-11-05 12:00:31.034926	2026-11-05 12:00:31.034926	repro 1793880031015	f	f	4	5	26	\N	\N	\N
97	2026-11-05 12:26:36.737533	2026-11-05 12:26:36.737533	nfnfdnvjcj	f	f	4	2	3	\N	\N	\N
98	2026-11-05 12:26:39.090985	2026-11-05 12:26:39.090985	x	f	f	4	2	3	\N	\N	\N
99	2026-11-05 12:26:41.24447	2026-11-05 12:26:41.24447	z	f	f	4	2	3	\N	\N	\N
100	2026-11-05 12:26:46.565352	2026-11-05 12:26:46.565352	h	f	f	4	2	1	\N	\N	\N
101	2026-11-05 12:26:48.715673	2026-11-05 12:26:48.715673	fn	f	f	4	2	1	\N	\N	\N
102	2026-11-05 12:26:50.971143	2026-11-05 12:26:50.971143	nfvn	f	f	4	2	1	\N	\N	\N
103	2026-11-05 12:26:53.334924	2026-11-05 12:26:53.334924	nxnf	f	f	4	2	1	\N	\N	\N
104	2026-11-05 12:26:56.294256	2026-11-05 12:26:56.294256	ndmgt	f	f	4	2	1	\N	\N	\N
105	2026-11-05 12:26:58.751101	2026-11-05 12:26:58.751101	ndrmgm	f	f	4	2	1	\N	\N	\N
106	2026-11-05 12:27:01.926698	2026-11-05 12:27:01.926698	mdmg	f	f	4	2	1	\N	\N	\N
107	2026-11-05 12:27:07.462583	2026-11-05 12:27:07.462583	bj	f	f	4	2	3	\N	\N	\N
108	2026-11-05 12:27:10.017755	2026-11-05 12:27:10.017755	kdfm	f	f	4	2	3	\N	\N	\N
109	2026-11-05 12:27:12.29962	2026-11-05 12:27:12.29962	dmgm	f	f	4	2	3	\N	\N	\N
110	2026-11-05 15:02:08.360673	2026-11-05 15:02:08.360673	سلام	f	f	4	2	1	\N	\N	\N
111	2026-11-05 15:02:18.824627	2026-11-05 15:02:18.824627	سلام	f	f	4	9	1	\N	\N	\N
112	2026-11-05 15:03:00.793596	2026-11-05 15:03:00.793596	لالالا	f	f	4	9	1	\N	\N	\N
113	2026-11-05 15:03:50.186019	2026-11-05 15:03:50.186019	میلن	f	f	4	2	1	\N	\N	\N
114	2026-11-05 15:31:26.849232	2026-11-05 15:31:26.849232	ت	f	f	4	2	1	\N	\N	\N
115	2026-11-05 15:34:54.892181	2026-11-05 15:34:54.892181	غاشقنم	f	f	4	9	27	\N	\N	\N
116	2026-11-05 15:35:06.439363	2026-11-05 15:35:06.439363	😍😍😍💗	f	f	4	2	27	\N	\N	\N
136	2026-11-05 23:29:08.635608	2026-11-08 17:33:18.582229	پلت	f	t	4	2	27	\N	\N	\N
118	2026-11-05 15:35:27.563086	2026-11-05 15:35:27.563086	ذاپ	f	f	4	9	27	\N	\N	\N
119	2026-11-05 15:39:51.270036	2026-11-05 15:39:51.270036	جوووونم عشقم	f	f	4	9	27	\N	\N	\N
120	2026-11-05 15:40:02.92807	2026-11-05 15:40:02.92807	💗💗🥰😍🙏🤝	f	f	4	2	27	\N	\N	\N
121	2026-11-05 15:40:41.011671	2026-11-05 15:40:41.011671	JXFJ	f	f	4	2	3	\N	\N	\N
128	2026-11-05 22:58:28.635472	2026-11-05 22:58:28.713271	preview 1793919508617	f	t	4	5	35	\N	\N	\N
122	2026-11-05 22:36:59.926007	2026-11-05 22:37:18.366523	edited2 1793918219973	t	t	4	5	31	\N	\N	\N
129	2026-11-05 23:08:09.408606	2026-11-05 23:08:09.408606	ذ	f	f	4	2	1	\N	\N	\N
123	2026-11-05 22:37:18.427579	2026-11-05 22:37:18.479521	preview 1793918238415	f	t	4	5	31	\N	\N	\N
117	2026-11-05 15:35:25.114059	2026-11-05 23:08:53.445003	پن	f	t	4	2	27	\N	\N	\N
124	2026-11-05 22:39:16.529782	2026-11-05 22:39:17.059055	edited!	t	f	4	10	33	\N	\N	\N
55	2026-11-04 23:29:49.026937	2026-11-05 23:09:19.681748	انت	t	f	4	2	3	\N	\N	\N
130	2026-11-05 23:14:37.279253	2026-11-05 23:14:37.279253	بوذو	f	f	4	2	1	\N	\N	\N
125	2026-11-05 22:39:48.853143	2026-11-05 22:39:52.262443	edited2 1793918388884	t	t	4	5	34	\N	\N	\N
126	2026-11-05 22:39:52.325267	2026-11-05 22:39:52.374099	preview 1793918392315	f	t	4	5	34	\N	\N	\N
131	2026-11-05 23:18:16.022262	2026-11-05 23:18:16.022262	مب	f	f	4	2	1	\N	\N	\N
139	2026-11-05 23:54:23.440893	2026-11-05 23:54:23.440893	نرنل	f	f	4	2	3	\N	\N	\N
127	2026-11-05 22:58:25.072806	2026-11-05 22:58:28.539508	edited2 1793919505130	t	t	4	5	35	\N	\N	\N
132	2026-11-05 23:18:48.835356	2026-11-05 23:18:52.787876	مبرم	f	t	4	2	27	\N	\N	\N
133	2026-11-05 23:19:03.021957	2026-11-05 23:19:03.021957	وزو	f	f	4	2	1	\N	\N	\N
134	2026-11-05 23:20:47.90067	2026-11-05 23:20:47.90067	ذلذ	f	f	4	2	1	\N	\N	\N
135	2026-11-05 23:28:00.685393	2026-11-05 23:28:00.685393	ل	f	f	4	2	3	\N	\N	\N
155	2026-11-08 17:32:23.969648	2026-11-08 17:33:32.292729	🙏	f	t	4	2	1	\N	\N	\N
137	2026-11-05 23:32:17.165084	2026-11-05 23:32:17.165084	ر	f	f	4	2	1	\N	\N	\N
140	2026-11-07 12:01:45.15024	2026-11-07 12:01:45.15024	عه این چیه	f	f	4	2	1	137	\N	\N
142	2026-11-07 12:20:57.200998	2026-11-07 12:20:57.200998	باشهه	f	f	4	2	1	8	\N	\N
143	2026-11-07 16:16:07.87917	2026-11-07 16:16:07.87917	جووووونم♥💋♥💋♥💋♥💋	f	f	4	9	27	\N	\N	\N
144	2026-11-07 16:17:00.487649	2026-11-07 16:17:13.246487	عاشقتم	f	t	4	2	27	143	\N	\N
141	2026-11-07 12:02:02.757625	2026-11-07 16:17:24.107867	ما بیشتر عشششقجونم	t	f	4	2	27	115	\N	\N
138	2026-11-05 23:54:18.011789	2026-11-08 17:33:14.88015	ر	f	t	4	2	27	\N	\N	\N
145	2026-11-08 10:08:01.857545	2026-11-08 17:33:05.757575	ذ	f	t	4	2	27	\N	\N	\N
148	2026-11-08 17:22:10.712994	2026-11-08 17:22:10.712994		f	f	4	2	1	\N	\N	\N
147	2026-11-08 11:09:43.587344	2026-11-08 11:25:28.70996	fkdkvfkdkvfkdkvfkdkvfkdkvfkdkvfkdkvfkdkvfkdkvfkdkvfkdkvfkdkv	f	t	4	2	27	\N	\N	\N
149	2026-11-08 17:23:06.865598	2026-11-08 17:23:06.865598		f	f	4	2	1	\N	\N	\N
150	2026-11-08 17:24:22.75535	2026-11-08 17:24:23.296391		f	t	4	2	1	\N	\N	\N
152	2026-11-08 17:25:58.646214	2026-11-08 17:25:58.646214	race 1	f	f	4	2	1	\N	\N	\N
151	2026-11-08 17:25:58.118272	2026-11-08 17:25:58.695768		f	t	4	2	1	\N	\N	\N
154	2026-11-08 17:31:29.597538	2026-11-08 17:31:29.597538		f	f	4	2	1	\N	\N	\N
146	2026-11-08 10:15:49.270163	2026-11-08 17:33:03.005084	ز	f	t	4	2	27	\N	\N	\N
156	2026-11-08 21:44:55.387356	2026-11-08 21:44:55.387356		f	f	4	2	1	\N	\N	\N
157	2026-11-08 21:45:06.169765	2026-11-08 21:45:52.752033	ر	f	t	4	2	1	\N	\N	\N
159	2026-11-08 21:48:50.470041	2026-11-08 21:48:50.470041	race 1	f	f	4	2	1	\N	\N	\N
205	2026-11-10 15:02:02.41691	2026-11-10 15:02:02.41691	ـ	f	f	4	2	36	\N	\N	\N
158	2026-11-08 21:48:50.004104	2026-11-08 21:48:50.515335		f	t	4	2	1	\N	\N	\N
161	2026-11-08 22:06:32.91219	2026-11-08 22:06:33.022037		f	t	5	2	1	\N	\N	\N
193	2026-11-10 07:38:14.829106	2026-11-10 07:38:14.829106	reaction-sender-1794296293975	f	f	4	9	36	\N	\N	\N
163	2026-11-08 22:07:05.951736	2026-11-08 22:07:05.951736	race 1	f	f	4	2	1	\N	\N	\N
162	2026-11-08 22:07:05.565559	2026-11-08 22:07:05.98692		f	t	4	2	1	\N	\N	\N
165	2026-11-08 22:14:12.979127	2026-11-08 22:14:12.979127		f	f	4	2	1	\N	\N	\N
166	2026-11-08 22:27:49.018219	2026-11-08 22:27:49.018219	بع	f	f	4	2	1	\N	\N	\N
167	2026-11-08 22:28:29.509447	2026-11-08 22:28:29.509447		f	f	4	2	1	\N	\N	\N
168	2026-11-08 22:29:42.307182	2026-11-08 22:29:42.307182		f	f	4	2	1	\N	\N	\N
169	2026-11-09 12:17:41.370192	2026-11-09 12:17:41.370192		f	f	4	2	1	\N	\N	\N
170	2026-11-09 12:18:02.460032	2026-11-09 12:18:02.460032		f	f	4	2	1	\N	\N	\N
171	2026-11-09 13:33:45.798509	2026-11-09 13:33:45.798509		f	f	4	2	3	\N	2	AMIR
172	2026-11-09 13:34:24.9474	2026-11-09 13:34:24.9474		f	f	4	2	3	\N	\N	\N
173	2026-11-09 16:01:20.030804	2026-11-09 16:01:27.292017		f	t	4	2	3	\N	\N	\N
174	2026-11-09 16:01:36.611003	2026-11-09 16:01:36.611003	ذد	f	f	4	2	3	\N	\N	\N
175	2026-11-09 17:05:26.256276	2026-11-09 17:05:26.256276	امروز خوش گذشت جون دلم	f	f	4	9	27	\N	\N	\N
176	2026-11-09 17:05:41.972879	2026-11-09 17:05:41.972879		f	f	4	2	27	\N	\N	\N
177	2026-11-09 17:05:44.071029	2026-11-09 17:05:44.071029	عشقم چی باعث خوشحالیت میشه؟	f	f	4	9	27	\N	\N	\N
178	2026-11-09 17:06:14.896816	2026-11-09 17:06:14.896816	🌹♥♥♥	f	f	4	9	27	\N	\N	\N
179	2026-11-09 17:06:17.865606	2026-11-09 17:06:17.865606	میخوای بدونی کیه؟	f	f	4	2	27	\N	\N	\N
180	2026-11-09 17:06:28.206587	2026-11-09 17:06:28.206587	گفتی چی بیسواد	f	f	4	9	27	\N	\N	\N
181	2026-11-09 17:06:45.414791	2026-11-09 17:06:45.414791	دختر خوشگله پیشم🤫	f	f	4	2	27	\N	\N	\N
182	2026-11-09 17:06:55.342434	2026-11-09 17:06:55.342434	میخوای بدونی کیه؟	f	f	4	2	27	\N	\N	\N
183	2026-11-09 17:07:05.072298	2026-11-09 17:07:05.072298	کیه	f	f	4	9	27	\N	\N	\N
184	2026-11-09 17:07:56.068065	2026-11-09 17:07:56.068065	ذ	f	f	4	2	1	\N	\N	\N
185	2026-11-09 17:08:00.150695	2026-11-09 17:08:00.150695	امیر جونم کیرم دهنت 😊🤭	f	f	4	9	27	\N	\N	\N
186	2026-11-09 17:08:27.820896	2026-11-09 17:08:27.820896	چشمش نزنیاا🤭	f	f	4	2	27	\N	\N	\N
187	2026-11-09 17:08:49.830462	2026-11-09 17:08:49.830462	دورت بگردم😍	f	f	4	9	27	\N	\N	\N
188	2026-11-09 17:09:29.572462	2026-11-09 17:09:29.572462	💗💗💗💗💗🌺💖💋	f	f	4	2	27	\N	\N	\N
189	2026-11-10 07:13:00.091313	2026-11-10 07:13:00.091313	سلاام	f	f	4	2	36	\N	\N	\N
206	2026-11-10 15:02:04.762038	2026-11-10 15:02:04.762038	.	f	f	4	2	36	\N	\N	\N
207	2026-11-10 15:02:07.738684	2026-11-10 15:02:07.738684	.	f	f	4	2	36	\N	\N	\N
196	2026-11-10 07:38:47.799467	2026-11-10 07:38:47.799467	reaction-other-chat-1794296326951	f	f	4	9	27	\N	\N	\N
197	2026-11-10 07:38:47.852982	2026-11-10 07:38:47.922479	reaction-deleted-1794296326951	f	t	4	2	36	\N	\N	\N
208	2026-11-10 15:03:34.594751	2026-11-10 15:03:34.594751	ل	f	f	4	2	27	\N	\N	\N
199	2026-11-10 07:38:48.912712	2026-11-10 07:38:48.912712	reaction-e2e-edited-1794296326951	f	f	4	9	36	\N	2	AMIR
209	2026-11-10 15:03:40.136144	2026-11-10 15:03:40.136144	اغت	f	f	4	2	27	\N	\N	\N
190	2026-11-10 07:37:34.497563	2026-11-10 07:56:55.510863	reaction-e2e-1794296254480	f	t	4	2	36	\N	\N	\N
191	2026-11-10 07:38:13.991187	2026-11-10 07:56:58.883595	reaction-e2e-1794296293975	f	t	4	2	36	\N	\N	\N
192	2026-11-10 07:38:14.242126	2026-11-10 07:57:02.063099	reaction-noop-1794296293975	f	t	4	2	36	\N	\N	\N
194	2026-11-10 07:38:46.96642	2026-11-10 07:57:09.251926	reaction-e2e-edited-1794296326951	t	t	4	2	36	\N	\N	\N
198	2026-11-10 07:38:47.989417	2026-11-10 07:57:12.913447	reaction-burst-1794296326951	f	t	4	2	36	\N	\N	\N
195	2026-11-10 07:38:47.177412	2026-11-10 07:57:15.68334	reaction-noop-1794296326951	f	t	4	2	36	\N	\N	\N
200	2026-11-10 07:38:48.954546	2026-11-10 07:57:18.960705	reaction-rate-1794296326951	f	t	4	2	36	\N	\N	\N
201	2026-11-10 14:58:58.36577	2026-11-10 14:58:58.36577	سلام	f	f	4	9	36	\N	\N	\N
202	2026-11-10 15:00:08.094332	2026-11-10 15:00:08.094332	@niazam	f	f	4	9	36	\N	\N	\N
203	2026-11-10 15:01:54.845241	2026-11-10 15:01:54.845241	چطورییی	f	f	4	2	36	201	\N	\N
204	2026-11-10 15:02:00.568	2026-11-10 15:02:00.568	.	f	f	4	2	36	\N	\N	\N
210	2026-11-10 15:04:37.633409	2026-11-10 15:04:37.633409	reaction-other-chat-1794296326951	f	f	4	9	36	\N	9	کژال خوشگلههه
211	2026-11-10 15:05:14.16769	2026-11-10 15:05:14.16769	jcfj	f	f	4	9	27	\N	\N	\N
212	2026-11-10 15:05:25.62387	2026-11-10 15:05:25.62387	ر	f	f	4	2	27	\N	\N	\N
213	2026-11-10 15:05:35.964194	2026-11-10 15:05:35.964194	ر	f	f	4	2	36	\N	\N	\N
\.


--
-- Data for Name: permission_admin; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.permission_admin (id, "createdAt", "updatedAt", "permissionId", "memberId") FROM stdin;
\.


--
-- Data for Name: permission_chats; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.permission_chats (id, "createdAt", "updatedAt", name) FROM stdin;
1	2026-11-03 13:10:41.952875	2026-11-05 12:34:35.481848	all
2	2026-11-03 13:10:41.952875	2026-11-05 12:34:35.481848	ban_user
3	2026-11-03 13:10:41.952875	2026-11-05 12:34:35.481848	change_info_chat
4	2026-11-03 13:10:41.952875	2026-11-05 12:34:35.481848	delete_message
\.


--
-- Data for Name: permissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.permissions (id, "createdAt", "updatedAt", name) FROM stdin;
1	2026-11-03 13:10:41.941527	2026-11-05 12:34:35.471233	ban_user
2	2026-11-03 13:10:41.941527	2026-11-05 12:34:35.471233	ban_chat
3	2026-11-03 13:10:41.941527	2026-11-05 12:34:35.471233	manage_react
\.


--
-- Data for Name: reacts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.reacts (id, "createdAt", "updatedAt", name, emoji) FROM stdin;
1	2026-11-10 07:23:57.489846	2026-11-10 07:23:57.489846	thumbs_up	👍
2	2026-11-10 07:23:57.499948	2026-11-10 07:23:57.499948	heart	❤️
3	2026-11-10 07:23:57.504091	2026-11-10 07:23:57.504091	joy	😂
4	2026-11-10 07:23:57.507817	2026-11-10 07:23:57.507817	open_mouth	😮
5	2026-11-10 07:23:57.512166	2026-11-10 07:23:57.512166	cry	😢
6	2026-11-10 07:23:57.516333	2026-11-10 07:23:57.516333	pray	🙏
\.


--
-- Data for Name: role_chat; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.role_chat (id, "createdAt", "updatedAt", name) FROM stdin;
1	2026-11-03 13:10:41.946857	2026-11-05 12:34:35.477012	manager
2	2026-11-03 13:10:41.946857	2026-11-05 12:34:35.477012	admin
3	2026-11-03 13:10:41.946857	2026-11-05 12:34:35.477012	user
4	2026-11-03 13:10:41.946857	2026-11-05 12:34:35.477012	ban
\.


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.roles (id, "createdAt", "updatedAt", name) FROM stdin;
1	2026-11-03 13:10:41.93098	2026-11-05 12:34:35.464494	owner
2	2026-11-03 13:10:41.93098	2026-11-05 12:34:35.464494	admin
3	2026-11-03 13:10:41.93098	2026-11-05 12:34:35.464494	user
\.


--
-- Data for Name: type_messages; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.type_messages (id, "createdAt", "updatedAt", name) FROM stdin;
1	2026-11-03 13:10:41.957388	2026-11-05 12:34:35.486428	file
2	2026-11-03 13:10:41.957388	2026-11-05 12:34:35.486428	ice
3	2026-11-03 13:10:41.957388	2026-11-05 12:34:35.486428	image
4	2026-11-03 13:10:41.957388	2026-11-05 12:34:35.486428	text
5	2026-11-03 13:10:41.957388	2026-11-05 12:34:35.486428	video
6	2026-11-03 13:10:41.957388	2026-11-05 12:34:35.486428	voice
\.


--
-- Data for Name: user_permissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_permissions (id, "createdAt", "updatedAt", "userId", "permissionId") FROM stdin;
\.


--
-- Data for Name: user_profiles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_profiles (id, "createdAt", "updatedAt", name, username, biografy, avatars, "userId") FROM stdin;
1	2026-11-03 13:10:49.169758	2026-11-03 13:10:49.169758	\N	\N	\N	{}	1
3	2026-11-03 13:27:56.369265	2026-11-03 13:27:56.369265	\N	\N	\N	{}	3
4	2026-11-03 13:48:33.836436	2026-11-03 13:48:33.836436	\N	\N	\N	{}	4
5	2026-11-04 22:36:54.090663	2026-11-04 22:36:54.090663	\N	\N	\N	{}	5
6	2026-11-04 22:36:54.288756	2026-11-04 22:36:54.288756	\N	\N	\N	{}	6
7	2026-11-04 22:38:17.90456	2026-11-04 22:38:17.90456	\N	\N	\N	{}	7
8	2026-11-04 22:38:27.124848	2026-11-04 22:38:27.124848	\N	\N	\N	{}	8
10	2026-11-05 22:39:16.209948	2026-11-05 22:39:16.209948	\N	\N	\N	{}	10
11	2026-11-07 18:48:20.344787	2026-11-07 19:08:04.247077	\N	\N	\N	{}	11
9	2026-11-05 14:57:04.779191	2026-11-08 11:28:57.982116	کژال خوشگلههه	kazhal		{uploads/avatars/24be14cb-2c20-49cc-8d56-b20a706c8d07.jpeg}	9
2	2026-11-03 13:15:49.326597	2026-11-08 11:51:16.287529	AMIR	niazama	lililili	{uploads/avatars/1794078912464-188710107.jpeg,uploads/avatars/1794078760730-456216252.jpeg,uploads/avatars/9c13431c-6853-4925-b01f-e41657143abb.jpeg}	2
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, "createdAt", "updatedAt", phone, "isOnline", "lastSeen", status, "refreshToken", "roleId") FROM stdin;
4	2026-11-03 13:48:33.836436	2026-11-08 17:25:57.75531	09199299879	f	2026-11-03 18:26:11.414	active	$2b$10$NAGX3Is4DhC3u9wsKykVkOtRLTsLZWrr3LIK0G5OPjwDqXRA3TwFK	3
6	2026-11-04 22:36:54.288756	2026-11-05 22:58:28.764065	+989100000002	f	2026-11-05 22:58:28.761	active	$2b$10$gjjrG6HgTvX2LSPR8DB.furwUJDQMOMjsfV2RSIZo2r3SbA3LvRPu	3
5	2026-11-04 22:36:54.090663	2026-11-05 22:58:28.766709	+989100000001	f	2026-11-05 22:58:28.765	active	$2b$10$U1cyAQ2N3GpzwzO48bce6uJ7g/JNFtLcTxAhD3MQKirxxSup5y40m	3
9	2026-11-05 14:57:04.779191	2026-11-10 15:03:02.910431	+989199299877	t	2026-11-10 15:03:02.495	active	$2b$10$yuMj9p.0GuL/5f/aMDiwJ.wMSP/9WJU8F1RZSZPdIZyI4ULpUW50C	3
8	2026-11-04 22:38:27.124848	2026-11-04 22:38:27.234635	+989100000005	f	2026-11-04 22:38:27.234	active	$2b$10$cJMj8W3gd0LYNUeZ/PKfW.sGS0458XmzpQiaamTja8/3gZsneGsgi	3
2	2026-11-03 13:15:49.326597	2026-11-10 20:00:23.6757	+989199299879	f	2026-11-10 20:00:23.667	active	$2b$10$KIFvJZQMK3K2psC4pXaKtuHU3Tws7cPJrozRBwEdOMxvzhvjGjon.	3
11	2026-11-07 18:48:20.344787	2026-11-07 18:48:20.427176	09990001111	f	\N	active	$2b$10$zPGbjTSwC/OwLGlE9tntIumI8gabmJqqLzYENd.YASjXeCyOy31x6	3
7	2026-11-04 22:38:17.90456	2026-11-05 22:39:19.577878	+989100000004	f	2026-11-05 22:39:19.577	active	$2b$10$CrpOJ35PGhyxbf8XaPJ7Auo67ViXAxr.qnGRNwIQX9hi3qBy4yrpy	3
10	2026-11-05 22:39:16.209948	2026-11-05 22:39:19.579247	+989100000003	f	2026-11-05 22:39:19.578	active	$2b$10$NQKxqRhJZl9pI3tCi1G2P.LPtC16HMFJH2N2ehXRpVmTqbrXItS06	3
3	2026-11-03 13:27:56.369265	2026-11-08 22:07:06.312922	09199299877	f	2026-11-08 22:07:06.312	active	$2b$10$YI/e2CypQank52LRU/MGfulZ199p.L/PFRinSEibADs/gf8vt7x1W	3
1	2026-11-03 13:10:49.169758	2026-11-10 07:39:50.478594	09123456789	f	2026-11-10 07:39:50.468	active	$2b$10$NC.H2PQG0GIFJosxKxQhPe9Yu5v99c1PvkrjeaLmNkw9RqP.fbW7O	1
\.


--
-- Name: attachments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.attachments_id_seq', 46, true);


--
-- Name: chat_members_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.chat_members_id_seq', 71, true);


--
-- Name: chat_seen_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.chat_seen_id_seq', 27, true);


--
-- Name: chats_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.chats_id_seq', 36, true);


--
-- Name: link_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.link_id_seq', 1, false);


--
-- Name: message_react_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.message_react_id_seq', 44, true);


--
-- Name: messages_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.messages_id_seq', 213, true);


--
-- Name: permission_admin_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.permission_admin_id_seq', 1, false);


--
-- Name: permission_chats_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.permission_chats_id_seq', 132, true);


--
-- Name: permissions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.permissions_id_seq', 99, true);


--
-- Name: reacts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.reacts_id_seq', 6, true);


--
-- Name: role_chat_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.role_chat_id_seq', 132, true);


--
-- Name: roles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.roles_id_seq', 99, true);


--
-- Name: type_messages_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.type_messages_id_seq', 198, true);


--
-- Name: user_permissions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.user_permissions_id_seq', 1, false);


--
-- Name: user_profiles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.user_profiles_id_seq', 21, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.users_id_seq', 11, true);


--
-- Name: chats PK_0117647b3c4a4e5ff198aeb6206; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT "PK_0117647b3c4a4e5ff198aeb6206" PRIMARY KEY (id);


--
-- Name: user_permissions PK_01f4295968ba33d73926684264f; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT "PK_01f4295968ba33d73926684264f" PRIMARY KEY (id);


--
-- Name: messages PK_18325f38ae6de43878487eff986; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT "PK_18325f38ae6de43878487eff986" PRIMARY KEY (id);


--
-- Name: user_profiles PK_1ec6662219f4605723f1e41b6cb; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT "PK_1ec6662219f4605723f1e41b6cb" PRIMARY KEY (id);


--
-- Name: link PK_26206fb7186da72fbb9eaa3fac9; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.link
    ADD CONSTRAINT "PK_26206fb7186da72fbb9eaa3fac9" PRIMARY KEY (id);


--
-- Name: permission_admin PK_582bb4cecc0615a61b6d4815177; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission_admin
    ADD CONSTRAINT "PK_582bb4cecc0615a61b6d4815177" PRIMARY KEY (id);


--
-- Name: attachments PK_5e1f050bcff31e3084a1d662412; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT "PK_5e1f050bcff31e3084a1d662412" PRIMARY KEY (id);


--
-- Name: permission_chats PK_6f6fbb421240dce1f726d7c7736; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission_chats
    ADD CONSTRAINT "PK_6f6fbb421240dce1f726d7c7736" PRIMARY KEY (id);


--
-- Name: chat_seen PK_71ac91afda8e6534214761a623c; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_seen
    ADD CONSTRAINT "PK_71ac91afda8e6534214761a623c" PRIMARY KEY (id);


--
-- Name: permissions PK_920331560282b8bd21bb02290df; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT "PK_920331560282b8bd21bb02290df" PRIMARY KEY (id);


--
-- Name: users PK_a3ffb1c0c8416b9fc6f907b7433; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY (id);


--
-- Name: chat_members PK_aea646f59c92c47af5804ce73a7; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_members
    ADD CONSTRAINT "PK_aea646f59c92c47af5804ce73a7" PRIMARY KEY (id);


--
-- Name: role_chat PK_b329eeb28616ebb64d9a3e64586; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_chat
    ADD CONSTRAINT "PK_b329eeb28616ebb64d9a3e64586" PRIMARY KEY (id);


--
-- Name: message_react PK_b920c5a6b38bbbfc21f68fa7e88; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.message_react
    ADD CONSTRAINT "PK_b920c5a6b38bbbfc21f68fa7e88" PRIMARY KEY (id);


--
-- Name: roles PK_c1433d71a4838793a49dcad46ab; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT "PK_c1433d71a4838793a49dcad46ab" PRIMARY KEY (id);


--
-- Name: type_messages PK_c43221f8dc44d724142423740b3; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.type_messages
    ADD CONSTRAINT "PK_c43221f8dc44d724142423740b3" PRIMARY KEY (id);


--
-- Name: reacts PK_e9a4e287e70372a267d7f363a12; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reacts
    ADD CONSTRAINT "PK_e9a4e287e70372a267d7f363a12" PRIMARY KEY (id);


--
-- Name: user_profiles REL_8481388d6325e752cd4d7e26c6; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT "REL_8481388d6325e752cd4d7e26c6" UNIQUE ("userId");


--
-- Name: reacts UQ_0ed05f93625b7d9a6cc703afd9c; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reacts
    ADD CONSTRAINT "UQ_0ed05f93625b7d9a6cc703afd9c" UNIQUE (name);


--
-- Name: reacts UQ_1ccb834b6dc016c31d29c5054e7; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reacts
    ADD CONSTRAINT "UQ_1ccb834b6dc016c31d29c5054e7" UNIQUE (emoji);


--
-- Name: role_chat UQ_23fe0a16ee1818e9e80e345a916; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_chat
    ADD CONSTRAINT "UQ_23fe0a16ee1818e9e80e345a916" UNIQUE (name);


--
-- Name: permissions UQ_48ce552495d14eae9b187bb6716; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT "UQ_48ce552495d14eae9b187bb6716" UNIQUE (name);


--
-- Name: roles UQ_648e3f5447f725579d7d4ffdfb7; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT "UQ_648e3f5447f725579d7d4ffdfb7" UNIQUE (name);


--
-- Name: user_profiles UQ_7bdaa0714f4c1087a926a2d8369; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT "UQ_7bdaa0714f4c1087a926a2d8369" UNIQUE (username);


--
-- Name: users UQ_a000cca60bcf04454e727699490; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "UQ_a000cca60bcf04454e727699490" UNIQUE (phone);


--
-- Name: attachments UQ_a462643468695e56a4ee6f2bdcf; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT "UQ_a462643468695e56a4ee6f2bdcf" UNIQUE ("storageKey");


--
-- Name: permission_chats UQ_a5a34b40f33730fe4b92528ffe1; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission_chats
    ADD CONSTRAINT "UQ_a5a34b40f33730fe4b92528ffe1" UNIQUE (name);


--
-- Name: link UQ_b118b8ec43546712aafecb95bd1; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.link
    ADD CONSTRAINT "UQ_b118b8ec43546712aafecb95bd1" UNIQUE (code);


--
-- Name: type_messages UQ_cf170b4c895ff71212eb7416567; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.type_messages
    ADD CONSTRAINT "UQ_cf170b4c895ff71212eb7416567" UNIQUE (name);


--
-- Name: IDX_7bdaa0714f4c1087a926a2d836; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "IDX_7bdaa0714f4c1087a926a2d836" ON public.user_profiles USING btree (username);


--
-- Name: IDX_a000cca60bcf04454e72769949; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "IDX_a000cca60bcf04454e72769949" ON public.users USING btree (phone);


--
-- Name: UQ_chats_pairKey; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "UQ_chats_pairKey" ON public.chats USING btree ("pairKey");


--
-- Name: UQ_message_react_user_message; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "UQ_message_react_user_message" ON public.message_react USING btree ("messageId", "userId");


--
-- Name: attachments FK_0509b378816d342ec0fecdbe1f1; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT "FK_0509b378816d342ec0fecdbe1f1" FOREIGN KEY ("chatId") REFERENCES public.chats(id) ON DELETE CASCADE;


--
-- Name: chat_members FK_23c13a72d263e5f355aef4e2a0d; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_members
    ADD CONSTRAINT "FK_23c13a72d263e5f355aef4e2a0d" FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: messages FK_2db9cf2b3ca111742793f6c37ce; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT "FK_2db9cf2b3ca111742793f6c37ce" FOREIGN KEY ("senderId") REFERENCES public.users(id);


--
-- Name: users FK_368e146b785b574f42ae9e53d5e; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "FK_368e146b785b574f42ae9e53d5e" FOREIGN KEY ("roleId") REFERENCES public.roles(id);


--
-- Name: messages FK_36bc604c820bb9adc4c75cd4115; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT "FK_36bc604c820bb9adc4c75cd4115" FOREIGN KEY ("chatId") REFERENCES public.chats(id) ON DELETE CASCADE;


--
-- Name: permission_admin FK_5cbcf02b38a5e1f2b41be8d92b9; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission_admin
    ADD CONSTRAINT "FK_5cbcf02b38a5e1f2b41be8d92b9" FOREIGN KEY ("permissionId") REFERENCES public.permission_chats(id) ON DELETE CASCADE;


--
-- Name: message_react FK_7181426e24c6d652ca4a0712f01; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.message_react
    ADD CONSTRAINT "FK_7181426e24c6d652ca4a0712f01" FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chat_seen FK_77c086c834f7d9a8836b2defb1f; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_seen
    ADD CONSTRAINT "FK_77c086c834f7d9a8836b2defb1f" FOREIGN KEY ("messageId") REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: chat_seen FK_78af00a433a062fc8fb58149b0c; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_seen
    ADD CONSTRAINT "FK_78af00a433a062fc8fb58149b0c" FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: permission_admin FK_78d03ebaf3d05a802f8eee51091; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission_admin
    ADD CONSTRAINT "FK_78d03ebaf3d05a802f8eee51091" FOREIGN KEY ("memberId") REFERENCES public.chat_members(id) ON DELETE CASCADE;


--
-- Name: user_profiles FK_8481388d6325e752cd4d7e26c6d; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT "FK_8481388d6325e752cd4d7e26c6d" FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chat_seen FK_b167319f28730414e9fde396b78; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_seen
    ADD CONSTRAINT "FK_b167319f28730414e9fde396b78" FOREIGN KEY ("chatId") REFERENCES public.chats(id) ON DELETE CASCADE;


--
-- Name: attachments FK_b8f8cb9f55776d30ebd6dc779ee; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT "FK_b8f8cb9f55776d30ebd6dc779ee" FOREIGN KEY ("uploaderId") REFERENCES public.users(id);


--
-- Name: message_react FK_baedd4774872108a640321e1f54; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.message_react
    ADD CONSTRAINT "FK_baedd4774872108a640321e1f54" FOREIGN KEY ("reactId") REFERENCES public.reacts(id) ON DELETE CASCADE;


--
-- Name: message_react FK_bceff330407e29562e8570ed7f6; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.message_react
    ADD CONSTRAINT "FK_bceff330407e29562e8570ed7f6" FOREIGN KEY ("messageId") REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: messages FK_ce57c627ff2fdaadc33271cec72; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT "FK_ce57c627ff2fdaadc33271cec72" FOREIGN KEY ("typeId") REFERENCES public.type_messages(id);


--
-- Name: user_permissions FK_cf38f85e52ee274ba9a01901ed2; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT "FK_cf38f85e52ee274ba9a01901ed2" FOREIGN KEY ("permissionId") REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: attachments FK_d25de32d1398e398a082f4f5d2a; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT "FK_d25de32d1398e398a082f4f5d2a" FOREIGN KEY ("messageId") REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: chat_members FK_d868b5eaf5fa161d7d45ec724a1; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_members
    ADD CONSTRAINT "FK_d868b5eaf5fa161d7d45ec724a1" FOREIGN KEY ("roleId") REFERENCES public.role_chat(id);


--
-- Name: link FK_da6bb9b79cb69f4dc649279c6ee; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.link
    ADD CONSTRAINT "FK_da6bb9b79cb69f4dc649279c6ee" FOREIGN KEY ("chatId") REFERENCES public.chats(id) ON DELETE CASCADE;


--
-- Name: chat_members FK_e98bf961346b1b32adf306136c6; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_members
    ADD CONSTRAINT "FK_e98bf961346b1b32adf306136c6" FOREIGN KEY ("chatId") REFERENCES public.chats(id) ON DELETE CASCADE;


--
-- Name: user_permissions FK_f05ccc7935f14874d7f89ba030f; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT "FK_f05ccc7935f14874d7f89ba030f" FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: messages FK_f550135b17eaf7c5452ae5fd4a8; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT "FK_f550135b17eaf7c5452ae5fd4a8" FOREIGN KEY ("replyToId") REFERENCES public.messages(id);


--
-- PostgreSQL database dump complete
--

\unrestrict Qc2YH1TVhjR7idhTbY0zvc3mPaucZQ8VkDiDtd7KOEqkEmH4I9RMltKkR0Sg9GL

